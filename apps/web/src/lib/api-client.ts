// placeholder — T1.4 implements the full typed HTTP client
import type {
  LoginRequest,
  LoginResponse,
  MeResponse,
  ConversationSummary,
} from "@bi/contracts";

export async function login(_req: LoginRequest): Promise<LoginResponse> {
  throw new Error("Not implemented — see T1.4");
}

export async function getMe(): Promise<MeResponse> {
  throw new Error("Not implemented — see T1.4");
}

export async function listConversations(): Promise<ConversationSummary[]> {
  throw new Error("Not implemented — see T1.4");
}
