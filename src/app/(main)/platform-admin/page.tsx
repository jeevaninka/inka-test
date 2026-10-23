import { redirect } from 'next/navigation';

export default function PlatformAdminRootPage() {
  redirect('/platform-admin/organizations');
}
