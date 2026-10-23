"use client";

import * as React from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';
import { MOTION } from '@/lib/motion';

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  tabsId: string;
}

const TabsContext = React.createContext<TabsContextValue | undefined>(undefined);

interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ defaultValue, value: controlledValue, onValueChange, className, children, ...props }, ref) => {
    const tabsId = React.useId();
    const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue || '');
    const value = controlledValue ?? uncontrolledValue;
    const handleValueChange = (newValue: string) => {
      setUncontrolledValue(newValue);
      onValueChange?.(newValue);
    };

    return (
      <TabsContext.Provider value={{ value, onValueChange: handleValueChange, tabsId }}>
        <div ref={ref} className={cn('space-y-2', className)} {...props}>
          {children}
        </div>
      </TabsContext.Provider>
    );
  }
);
Tabs.displayName = 'Tabs';

const TabsList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'inline-flex h-9 items-center justify-center rounded-xl bg-muted/60 p-1 text-muted-foreground select-none relative',
      className
    )}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, children, ...props }, ref) => {
    const context = React.useContext(TabsContext);
    if (!context) throw new Error('TabsTrigger must be used within Tabs');

    const isSelected = context.value === value;

    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        aria-selected={isSelected}
        className={cn(
          'relative z-10 inline-flex items-center justify-center whitespace-nowrap rounded-lg px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer',
          isSelected ? 'text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground',
          className
        )}
        onClick={() => context.onValueChange(value)}
        {...props}
      >
        {isSelected && (
          <motion.div
            layoutId={`tab-indicator-${context.tabsId}`}
            className="absolute inset-0 bg-background rounded-lg shadow-xs -z-10"
            transition={MOTION.spring.pill}
          />
        )}
        <span className="relative z-10 flex items-center justify-center gap-1.5">{children}</span>
      </button>
    );
  }
);
TabsTrigger.displayName = 'TabsTrigger';

interface TabsContentProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  value: string;
  children?: React.ReactNode;
}

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, children, ...props }, ref) => {
    const context = React.useContext(TabsContext);
    if (!context) throw new Error('TabsContent must be used within Tabs');

    if (context.value !== value) return null;

    return (
      <motion.div
        ref={ref}
        role="tabpanel"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: MOTION.duration.fast, ease: MOTION.ease }}
        className={cn('mt-2 focus-visible:outline-none', className)}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);
TabsContent.displayName = 'TabsContent';

export { Tabs, TabsList, TabsTrigger, TabsContent };
