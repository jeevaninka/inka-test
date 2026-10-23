"use client";

import { motion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { MOTION } from '@/lib/motion';

interface PageTransitionProps {
  children: React.ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();

  // Normalize path so case switching inside test runs does not trigger full-page fade animations
  const transitionKey = pathname ? pathname.replace(/\/runs\/[^/]+(?:\/[^/]+)?$/, '/runs/_active_run') : pathname;

  return (
    <motion.div
      key={transitionKey}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MOTION.duration.base, ease: MOTION.ease }}
    >
      {children}
    </motion.div>
  );
}
