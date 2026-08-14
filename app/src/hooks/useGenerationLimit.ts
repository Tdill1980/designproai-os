import { useState, useEffect } from "react";

const STORAGE_KEY = "restylepro-generations";
const FREE_LIMIT = 2;

export const useGenerationLimit = () => {
  const [generationCount, setGenerationCount] = useState(0);
  const [hasReachedLimit, setHasReachedLimit] = useState(false);

  useEffect(() => {
    const count = parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
    setGenerationCount(count);
    setHasReachedLimit(count >= FREE_LIMIT);
  }, []);

  const incrementGeneration = () => {
    const newCount = generationCount + 1;
    localStorage.setItem(STORAGE_KEY, newCount.toString());
    setGenerationCount(newCount);
    setHasReachedLimit(newCount >= FREE_LIMIT);
  };

  const resetGenerations = () => {
    localStorage.setItem(STORAGE_KEY, "0");
    setGenerationCount(0);
    setHasReachedLimit(false);
  };

  return {
    generationCount,
    hasReachedLimit,
    remainingGenerations: Math.max(0, FREE_LIMIT - generationCount),
    incrementGeneration,
    resetGenerations,
  };
};
