import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  confirmPassword: z.string(),
  role: z.enum(['creator', 'worker']),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const jobSubmissionSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required').max(1000, 'Prompt must be less than 1000 characters'),
  model: z.string().optional(),
  width: z.number().min(256).max(1024).optional(),
  height: z.number().min(256).max(1024).optional(),
  num_images: z.number().min(1).max(4).optional(),
});

export type JobSubmissionInput = z.infer<typeof jobSubmissionSchema>;

export const depositSchema = z.object({
  amount: z.number().min(1, 'Minimum deposit is $1').max(10000, 'Maximum deposit is $10,000'),
  payment_method: z.string().optional(),
});

export type DepositInput = z.infer<typeof depositSchema>;

export const withdrawSchema = z.object({
  amount: z.number().min(1, 'Minimum withdrawal is $1').max(10000, 'Maximum withdrawal is $10,000'),
  destination: z.string().optional(),
});

export type WithdrawInput = z.infer<typeof withdrawSchema>;

export const workerRegistrationSchema = z.object({
  hostname: z.string().min(1, 'Hostname is required'),
  cpu_cores: z.number().min(1, 'At least 1 CPU core is required'),
  ram_gb: z.number().min(1, 'At least 1GB RAM is required'),
  gpu_model: z.string().optional(),
  wallet_address: z.string().optional(),
});

export type WorkerRegistrationInput = z.infer<typeof workerRegistrationSchema>;

export function getFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  error.issues.forEach((issue) => {
    const field = issue.path.join('_');
    fieldErrors[field] = issue.message;
  });
  return fieldErrors;
}

export function getErrorSummary(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join(', ');
}

