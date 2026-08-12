import { useState, useEffect } from "react";

export const useWaitlistStatus = () => {
  const [hasJoinedWaitlist, setHasJoinedWaitlist] = useState(false);

  useEffect(() => {
    const status = localStorage.getItem("waitlist_joined");
    setHasJoinedWaitlist(status === "true");
  }, []);

  const markAsJoined = () => {
    localStorage.setItem("waitlist_joined", "true");
    setHasJoinedWaitlist(true);
  };

  return { hasJoinedWaitlist, markAsJoined };
};
