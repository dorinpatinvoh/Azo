import { api } from "./api";

export type SettlementStatus = "IN_PROGRESS" | "DROPPED_OFF_PENDING" | "DISPUTED" | "COMPLETED";

export type Settlement = {
  status: SettlementStatus;
  confirmationDeadline?: string;
  problemReason?: string | null;
};

export const settlementApi = {
  status: (rideId: string) => api.get<Settlement>(`/rides/${rideId}/settlement`),
  dropoff: (rideId: string) => api.post<{ rideId: string; status: "DROPPED_OFF_PENDING"; confirmationDeadline: string }>(`/rides/${rideId}/dropoff`),
  confirmDropoff: (rideId: string) => api.post<{ status: "COMPLETED"; confirmedAt: string }>(`/rides/${rideId}/confirm-dropoff`),
  reportProblem: (rideId: string, reason: string) => api.post<{ status: "DISPUTED"; message: string }>(`/rides/${rideId}/report-problem`, { reason }),
};
