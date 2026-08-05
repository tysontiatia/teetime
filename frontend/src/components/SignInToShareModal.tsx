import { SignInPromptModal } from './SignInPromptModal';

/** Thin wrapper — prefer SignInPromptModal with variant="share". */
export function SignInToShareModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SignInPromptModal open={open} onClose={onClose} variant="share" />;
}
