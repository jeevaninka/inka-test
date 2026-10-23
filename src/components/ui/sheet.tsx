"use client";

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { motion, AnimatePresence, type HTMLMotionProps } from 'framer-motion';
import { MOTION } from '@/lib/motion';

interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

const SheetContext = React.createContext<{
  open: boolean;
  onClose: () => void;
}>({
  open: false,
  onClose: () => {},
});

const Sheet: React.FC<SheetProps> = ({ open = false, onOpenChange, children }) => {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (open) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [open]);

  const handleClose = React.useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  if (!mounted) return null;

  return (
    <SheetContext.Provider value={{ open, onClose: handleClose }}>
      {createPortal(
        <AnimatePresence>
          {open && children}
        </AnimatePresence>,
        document.body
      )}
    </SheetContext.Provider>
  );
};

interface SheetContentProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children?: React.ReactNode;
  side?: 'left' | 'right' | 'top' | 'bottom';
  onClose?: () => void;
  hideClose?: boolean;
}

const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
  ({ className, children, side = 'right', onClose, hideClose = false, ...props }, ref) => {
    const ctx = React.useContext(SheetContext);
    const handleClose = onClose ?? ctx.onClose;

    const variants = {
      left: { x: '-100%', y: 0 },
      right: { x: '100%', y: 0 },
      top: { x: 0, y: '-100%' },
      bottom: { x: 0, y: '100%' },
    };

    return (
      <div className="fixed inset-0 z-50 overflow-hidden pointer-events-auto">
        {/* Backdrop: cost-effective plain bg-black/50 without blur */}
        <motion.div
          key="sheet-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: MOTION.duration.base, ease: MOTION.ease }}
          className="fixed inset-0 bg-black/50"
          onClick={handleClose}
        />

        <motion.div
          key="sheet-panel"
          ref={ref}
          initial={variants[side]}
          animate={{ x: 0, y: 0 }}
          exit={variants[side]}
          transition={MOTION.spring.drawer}
          className={cn(
            'fixed z-50 bg-background shadow-2xl flex flex-col',
            side === 'left' && 'inset-y-0 left-0 h-full w-3/4 sm:max-w-sm',
            side === 'right' && 'inset-y-0 right-0 h-full w-3/4 sm:max-w-sm',
            side === 'top' && 'inset-x-0 top-0 w-full',
            side === 'bottom' && 'inset-x-0 bottom-0 w-full',
            className
          )}
          {...props}
        >
          {children}
          {!hideClose && (
            <button
              type="button"
              className="absolute right-4 top-4 rounded-lg p-1 opacity-70 transition-opacity hover:opacity-100 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
              onClick={handleClose}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </button>
          )}
        </motion.div>
      </div>
    );
  }
);
SheetContent.displayName = 'SheetContent';

const SheetHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => (
  <div className={cn('flex flex-col space-y-2 text-left', className)} {...props} />
);

const SheetTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn('text-base font-semibold text-foreground', className)}
    {...props}
  />
));
SheetTitle.displayName = 'SheetTitle';

const SheetDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-xs text-muted-foreground', className)}
    {...props}
  />
));
SheetDescription.displayName = 'SheetDescription';

export { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription };
