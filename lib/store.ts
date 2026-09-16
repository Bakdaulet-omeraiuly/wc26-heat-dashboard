import { create } from "zustand";

interface HeatDashboardState {
  selectedStadiumId: string | null;
  // The scrubber's current position -- month (1-12) and hour-of-day
  // (0-23), matching climatology.json's bucket keys. Deliberately not a
  // full Date: we're picking a point in a RECURRING annual/daily cycle
  // (climatology), not one calendar date.
  month: number;
  hour: number;
  // Which of the selected stadium's real matches (data/matches.json,
  // sorted hottest-first) is the reference point for "hours from
  // kickoff" -- shared between Stadium3D (the 3D cars + match picker)
  // and StadiumPanel (the text stats below it) so scrubbing the SAME
  // hour control changes parking occupancy consistently everywhere,
  // not just in the 3D view. Reset to 0 whenever the stadium changes.
  matchIndex: number;
  setSelectedStadium: (id: string | null) => void;
  setMonth: (month: number) => void;
  setHour: (hour: number) => void;
  setMatchIndex: (i: number) => void;
}

export const useHeatDashboardStore = create<HeatDashboardState>((set) => ({
  selectedStadiumId: null,
  month: 7, // July -- peak of the tournament window, sensible default
  hour: 15, // 3pm -- a plausible early-kickoff time, sensible default
  matchIndex: 0,
  setSelectedStadium: (id) => set({ selectedStadiumId: id, matchIndex: 0 }),
  setMonth: (month) => set({ month }),
  setHour: (hour) => set({ hour }),
  setMatchIndex: (i) => set({ matchIndex: i }),
}));
