import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MensagemProvider } from '../shared/mensagem';
import { AuthProvider } from '../features/auth/AuthContext';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MensagemProvider>{children}</MensagemProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
