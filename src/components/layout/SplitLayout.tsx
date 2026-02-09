'use client';

// --- Types ---

interface SplitLayoutProps {
  editor: React.ReactNode;
  sidePanel: React.ReactNode;
}

// --- Component ---

export function SplitLayout({ editor, sidePanel }: SplitLayoutProps) {
  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-[65%]">
        {editor}
      </div>
      <div className="w-[35%] border-l border-gray-200 dark:border-gray-700">
        {sidePanel}
      </div>
    </div>
  );
}
