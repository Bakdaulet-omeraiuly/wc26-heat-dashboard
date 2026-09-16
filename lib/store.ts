import { create } from "zustand";

interface HeatDashboardState {
  selectedStadiumId: string | null;
  // The scrubber's current position -- month (1-12) and hour-of-day
  // (0-23), matching climatology.json's bucket keys. Deliberately not a
  // full Date: we're picking a point in a RECURRING annual/daily cycle
  // (climatology), not one calendar date.
  month: number;
  hour: number;
  setSelectedStadium: (id: string | null) => void;
  setMonth: (month: number) => void;
  setHour: (hour: number) => void;
}

export const useHeatDashboardStore = create<HeatDashboardState>((set) => ({
  selectedStadiumId: null,
  month: 7, // July -- peak of the tournament window, sensible default
  hour: 15, // 3pm -- a plausible early-kickoff time, sensible default
  setSelectedStadium: (id) => set({ selectedStadiumId: id }),
  setMonth: (month) => set({ month }),
  setHour: (hour) => set({ hour }),
}));
