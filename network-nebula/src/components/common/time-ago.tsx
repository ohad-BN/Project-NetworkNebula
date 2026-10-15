import { useState, useEffect } from "react";

interface TimeAgoProps {
  timestamp: Date | string;
  className?: string;
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return "just now";
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return diffInMinutes === 1 ? "1 minute ago" : `${diffInMinutes} minutes ago`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return diffInHours === 1 ? "1 hour ago" : `${diffInHours} hours ago`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 30) {
    return diffInDays === 1 ? "1 day ago" : `${diffInDays} days ago`;
  }

  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInMonths < 12) {
    return diffInMonths === 1 ? "1 month ago" : `${diffInMonths} months ago`;
  }

  const diffInYears = Math.floor(diffInMonths / 12);
  return diffInYears === 1 ? "1 year ago" : `${diffInYears} years ago`;
}

export function TimeAgo({ timestamp, className }: TimeAgoProps) {
  const [timeAgo, setTimeAgo] = useState<string>("");

  useEffect(() => {
    const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
    setTimeAgo(formatTimeAgo(date));

    const interval = setInterval(() => {
      setTimeAgo(formatTimeAgo(date));
    }, 60000);

    return () => clearInterval(interval);
  }, [timestamp]);

  return (
    <span className={className} title={new Date(timestamp).toLocaleString()}>
      {timeAgo}
    </span>
  );
}
