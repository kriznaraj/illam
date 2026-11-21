'use client';

export function MonthViewSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card animate-pulse">
          {/* Date header */}
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
            <div className="h-5 bg-gray-200 rounded w-48"></div>
            <div className="h-5 bg-gray-200 rounded w-24"></div>
          </div>

          {/* Expenses */}
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-6 h-6 bg-gray-200 rounded-full"></div>
                  <div className="flex-1">
                    <div className="h-4 bg-gray-200 rounded w-32 mb-1"></div>
                    <div className="h-3 bg-gray-200 rounded w-48"></div>
                  </div>
                </div>
                <div className="flex items-center gap-4 ml-4">
                  <div className="h-5 bg-gray-200 rounded w-20"></div>
                  <div className="w-6 h-6 bg-gray-200 rounded"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
