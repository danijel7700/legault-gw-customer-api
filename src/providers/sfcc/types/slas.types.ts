export interface SlasGuestTokenRequest {
  readonly grant_type: 'client_credentials';
  readonly channel_id: string;
}

export interface SlasGuestTokenResponse {
  readonly access_token: string;
  readonly token_type?: string;
  readonly expires_in?: number;
  readonly usid?: string;
}
