import { useUIStore } from '@/stores/ui-store';
import { NetworkError, AuthError, ValidationError, ServerError, NotFoundError, getErrorMessage } from '@/types/errors';

export async function handleApiError(response: Response): Promise<never> {
  const data = await response.json().catch(() => ({}));
  const message = data.detail || data.message || 'An error occurred';

  switch (response.status) {
    case 400:
      throw new ValidationError(message, data.field_errors);
    case 401:
    case 403:
      throw new AuthError(message, response.status);
    case 404:
      throw new NotFoundError(message);
    case 500:
    default:
      throw new ServerError(message, response.status);
  }
}

export function showErrorToast(error: unknown, title?: string): void {
  const message = getErrorMessage(error);
  const toastTitle = title || 'Error';
  
  useUIStore.getState().addToast({
    type: 'error',
    title: toastTitle,
    message,
  });
}

export function showSuccessToast(message: string, title = 'Success'): void {
  useUIStore.getState().addToast({
    type: 'success',
    title,
    message,
  });
}

export function showInfoToast(message: string, title = 'Info'): void {
  useUIStore.getState().addToast({
    type: 'info',
    title,
    message,
  });
}

export function showWarningToast(message: string, title = 'Warning'): void {
  useUIStore.getState().addToast({
    type: 'warning',
    title,
    message,
  });
}

export { NetworkError, AuthError, ValidationError, ServerError, NotFoundError, getErrorMessage };

