"use client";

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function ConnectionsRedirectPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params?.slug as string;

  useEffect(() => {
    if (slug) {
      router.replace(`/p/${slug}/settings/developer`);
    }
  }, [slug, router]);

  return null;
}
