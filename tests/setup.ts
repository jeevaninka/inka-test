import { MotionGlobalConfig } from 'framer-motion';

// Instantly skip framer-motion animations during tests to avoid timing flakiness
MotionGlobalConfig.skipAnimations = true;
