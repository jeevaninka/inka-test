import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from './db';
import bcrypt from 'bcryptjs';
import { cache } from 'react';
import { getServerSession, type NextAuthOptions } from 'next-auth';
import { logger } from '@/lib/logger';
import { ErrorCodes, normalizeError } from '@/lib/errors';
import { issueEmailVerification } from '@/lib/auth/verification';
import { enforceLoginRateLimit, loginRateLimitKey, resetRateLimit } from '@/lib/rate-limit';

const isProduction =
  process.env.NODE_ENV === 'production' ||
  process.env.NEXT_PUBLIC_APP_ENV === 'production' ||
  process.env.APP_ENV === 'production';

/**
 * Errors thrown from this file are surfaced to the browser by NextAuth, so only
 * messages wrapped in this class are allowed through. Anything else (Prisma,
 * bcrypt, network) is reported as a generic failure.
 */
class UserFacingAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingAuthError';
  }
}

const providers: NextAuthOptions['providers'] = [
  GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    authorization: {
      params: {
        prompt: 'consent',
        access_type: 'offline',
        response_type: 'code',
      },
    },
  }),
];

providers.push(
  CredentialsProvider({
    name: 'credentials',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
      name: { label: 'Name', type: 'text' },
      action: { label: 'Action', type: 'text' },
    },
    async authorize(credentials) {
      try {
        if (!credentials?.email || !credentials?.password) return null;

        const action = credentials.action || 'signin';
        const normalizedEmail = credentials.email.trim().toLowerCase();

        if (action === 'signup') {
          if (!credentials.name?.trim()) {
            throw new UserFacingAuthError('Please enter your full name.');
          }
          if (credentials.password.length < 10) {
            throw new UserFacingAuthError('Password must be at least 10 characters long.');
          }
          if (!/[A-Z]/.test(credentials.password) || !/[0-9]/.test(credentials.password)) {
            throw new UserFacingAuthError(
              'Password must contain at least one uppercase letter and one number.'
            );
          }

          const existingUser = await prisma.user.findUnique({
            where: { email: normalizedEmail },
          });

          const passwordHash = await bcrypt.hash(credentials.password, 12);

          if (existingUser) {
            if (!existingUser.password_hash) {
              // User was pre-created via project/workspace invite stub — complete registration
              const updatedUser = await prisma.user.update({
                where: { id: existingUser.id },
                data: {
                  password_hash: passwordHash,
                  name: credentials.name.trim(),
                },
              });

              if (!updatedUser.email_verified) {
                await issueEmailVerification(updatedUser);
              }

              return {
                id: String(updatedUser.id),
                email: updatedUser.email,
                name: updatedUser.name,
                image: updatedUser.image,
                isApproved: updatedUser.is_approved,
                emailVerified: updatedUser.email_verified,
              };
            }
            throw new UserFacingAuthError('An account with this email already exists');
          }

          const userCount = await prisma.user.count();

          const user = await prisma.user.create({
            data: {
              email: normalizedEmail,
              name: credentials.name.trim(),
              password_hash: passwordHash,
              is_approved: userCount === 0,
              email_verified: false,
            },
          });

          await issueEmailVerification(user);

          return {
            id: String(user.id),
            email: user.email,
            name: user.name,
            image: user.image,
            isApproved: user.is_approved,
            emailVerified: false,
          };
        }

        // Sign in flow
        enforceLoginRateLimit(normalizedEmail);

        const user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
        });

        if (!user) {
          throw new UserFacingAuthError('No account found with this email');
        }

        if (!user.password_hash) {
          throw new UserFacingAuthError('This email uses Google OAuth. Please sign in with Google.');
        }

        const isValid = await bcrypt.compare(credentials.password, user.password_hash);
        if (!isValid) {
          throw new UserFacingAuthError('Invalid password');
        }

        resetRateLimit(loginRateLimitKey(normalizedEmail));

        return {
          id: String(user.id),
          email: user.email,
          name: user.name,
          image: user.image,
          isApproved: user.is_approved,
          emailVerified: user.email_verified,
        };
      } catch (err: any) {
        const isUserFacing = err instanceof UserFacingAuthError;
        const cleanMessage = (err?.message || 'Authentication failed')
          .replace(/[\r\n]+/g, ' ')
          .trim();
        const normalized = normalizeError(err, ErrorCodes.UNAUTHORIZED, cleanMessage);
        logger.warn('Credentials authentication failed', {
          module: 'Auth',
          action: credentials?.action || 'signin',
          email: credentials?.email,
          reason: cleanMessage,
          authErrorCode: normalized.code,
        });
        // Never leak Prisma/internal error details to the client.
        throw new Error(isUserFacing ? cleanMessage : 'Something went wrong. Please try again.');
      }
    },
  })
);

interface CachedUserStatus {
  isApproved: boolean;
  isPlatformAdmin: boolean;
  emailVerified: boolean;
  cachedAt: number;
}

const globalForAuth = globalThis as unknown as {
  userStatusCache?: Map<number, CachedUserStatus>;
};

const userStatusCache =
  globalForAuth.userStatusCache ?? new Map<number, CachedUserStatus>();

if (process.env.NODE_ENV !== 'production') {
  globalForAuth.userStatusCache = userStatusCache;
}

export const authOptions: NextAuthOptions = {
  providers,
  // Cookies are HttpOnly + SameSite=Lax and Secure in production. Declared
  // explicitly so a future NextAuth upgrade cannot silently weaken them.
  useSecureCookies: isProduction,
  cookies: {
    sessionToken: {
      name: `${isProduction ? '__Secure-' : ''}next-auth.session-token`,
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: isProduction },
    },
    csrfToken: {
      name: `${isProduction ? '__Host-' : ''}next-auth.csrf-token`,
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: isProduction },
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60, // 7 days max session lifetime
    updateAge: 60 * 60,       // 1 hour rolling refresh
  },
  logger: {
    error(code, metadata) {
      // Suppress noisy expired JWT cookie logs when an old browser cookie expires
      if (code === 'JWT_SESSION_ERROR') return;
      logger.error(`NextAuth error: ${code}`, {
        module: 'Auth',
        action: 'nextAuthError',
        nextAuthCode: code,
        errorCode: ErrorCodes.UNAUTHORIZED,
        error: metadata instanceof Error ? metadata : (metadata as any)?.error || code,
      });
    },
    warn(code) {
      logger.warn(`NextAuth warning: ${code}`, {
        module: 'Auth',
        action: 'nextAuthWarn',
        nextAuthCode: code,
      });
    },
  },
  callbacks: {
    async jwt({ token, user, trigger, session }: any) {
      if (trigger === 'update') {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.userId },
          select: { id: true, is_approved: true, email_verified: true, is_platform_admin: true, avatar_color: true, avatar_initials: true, display_name: true },
        });
        if (dbUser) {
          token.isApproved = dbUser.is_approved;
          token.emailVerified = dbUser.email_verified;
          token.isPlatformAdmin = Boolean(dbUser.is_platform_admin);
          token.avatarColor = dbUser.avatar_color;
          token.avatarInitials = dbUser.avatar_initials;
          token.displayName = dbUser.display_name;
          userStatusCache.set(token.userId, {
            isApproved: dbUser.is_approved,
            isPlatformAdmin: Boolean(dbUser.is_platform_admin),
            emailVerified: dbUser.email_verified,
            cachedAt: Date.now(),
          });
        }
        if (session?.workspaceId) {
          token.workspaceId = session.workspaceId;
        }
        if (session?.workspaceSlug) {
          token.workspaceSlug = session.workspaceSlug;
        }
      }
      
      if (user) {
        // Find user by email to ensure OAuth logins map to the correct DB record
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email },
          select: { id: true, is_approved: true, email_verified: true, is_platform_admin: true, avatar_color: true, avatar_initials: true, display_name: true },
        });

        token.userId = dbUser?.id ?? (typeof user.id === 'string' && !isNaN(parseInt(user.id, 10)) ? parseInt(user.id, 10) : user.id);
        token.isApproved = dbUser?.is_approved ?? user.isApproved ?? false;
        token.emailVerified = dbUser?.email_verified ?? user.emailVerified ?? false;
        token.isPlatformAdmin = Boolean(dbUser?.is_platform_admin);
        token.avatarColor = dbUser?.avatar_color ?? null;
        token.avatarInitials = dbUser?.avatar_initials ?? null;
        token.displayName = dbUser?.display_name ?? null;
        if (typeof token.userId === 'number') {
          userStatusCache.set(token.userId, {
            isApproved: Boolean(token.isApproved),
            isPlatformAdmin: Boolean(token.isPlatformAdmin),
            emailVerified: Boolean(token.emailVerified),
            cachedAt: Date.now(),
          });
        }
      }

      if (token.userId && typeof token.userId === 'number') {
        const now = Date.now();
        const cached = userStatusCache.get(token.userId);
        const needsUserCheck =
          (trigger !== 'update' && !user && (!cached || now - cached.cachedAt >= 60000)) ||
          token.isPlatformAdmin === undefined;
        const needsWorkspaceCheck = !token.workspaceId;

        if (!needsUserCheck && cached) {
          token.isApproved = cached.isApproved;
          token.isPlatformAdmin = cached.isPlatformAdmin;
          token.emailVerified = cached.emailVerified;
        }

        if (needsUserCheck || needsWorkspaceCheck) {
          const [dbUser, member] = await Promise.all([
            needsUserCheck
              ? prisma.user.findUnique({
                  where: { id: token.userId },
                  select: { is_approved: true, email_verified: true, is_platform_admin: true },
                })
              : Promise.resolve(null),
            needsWorkspaceCheck
              ? prisma.workspaceMember.findFirst({
                  where: { user_id: token.userId },
                  include: { workspace: { select: { slug: true } } },
                  orderBy: { last_active_at: 'desc' },
                })
              : Promise.resolve(null),
          ]);

          if (needsUserCheck) {
            token.isApproved = dbUser?.is_approved ?? false;
            token.emailVerified = dbUser?.email_verified ?? false;
            token.isPlatformAdmin = Boolean(dbUser?.is_platform_admin);
            userStatusCache.set(token.userId, {
              isApproved: token.isApproved,
              isPlatformAdmin: token.isPlatformAdmin,
              emailVerified: Boolean(token.emailVerified),
              cachedAt: now,
            });
          }

          if (member) {
            token.workspaceId = member.workspace_id;
            token.workspaceSlug = member.workspace.slug;
          }
        }
      }

      return token;
    },
    async session({ session, token }: any) {
      if (session.user && token) {
        session.user.id = token.userId;
        session.user.isApproved = token.isApproved;
        session.user.emailVerified = Boolean(token.emailVerified);
        session.user.isPlatformAdmin = Boolean(token.isPlatformAdmin);
        session.user.workspaceId = token.workspaceId;
        session.user.workspaceSlug = token.workspaceSlug;
        session.user.avatarColor = token.avatarColor ?? null;
        session.user.avatarInitials = token.avatarInitials ?? null;
        session.user.displayName = token.displayName ?? null;
      }
      return session;
    },
    async signIn({ account, profile }: any) {
      if (account?.provider === 'google') {
        if (profile?.email) {
          let existingUser = await prisma.user.findUnique({
            where: { email: profile.email as string },
          });

          if (!existingUser) {
            const userCount = await prisma.user.count();

            existingUser = await prisma.user.create({
              data: {
                email: profile.email as string,
                name: profile.name,
                image: (profile as any).picture,
                is_approved: userCount === 0,
                email_verified: true,
              },
            });
          } else if (!existingUser.email_verified) {
            // Google has already verified ownership of this address.
            existingUser = await prisma.user.update({
              where: { id: existingUser.id },
              data: {
                email_verified: true,
                email_verification_token: null,
                email_verification_expires: null,
              },
            });
          }
        }
      }
      return true;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  events: {
    async signIn({ user, account, profile, isNewUser }: any) {
      logger.info('User signed in', {
        module: 'Auth',
        action: 'signIn',
        userId: user.id,
        email: user.email,
        provider: account?.provider,
        isNewUser,
      });
    },
    async signOut({ token }: any) {
      logger.info('User signed out', {
        module: 'Auth',
        action: 'signOut',
        userId: token?.userId,
        email: token?.email,
      });
    },
  },
};

export const getCachedServerSession = cache(() => getServerSession(authOptions));
