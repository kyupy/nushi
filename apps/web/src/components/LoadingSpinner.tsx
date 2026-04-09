interface LoadingSpinnerProps {
  message?: string;
}

export default function LoadingSpinner({ message }: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-4 border-gray-200" />
        <div className="absolute inset-0 rounded-full border-4 border-line-green border-t-transparent animate-spin" />
      </div>
      {message && (
        <p className="text-sm text-gray-500">{message}</p>
      )}
    </div>
  );
}
