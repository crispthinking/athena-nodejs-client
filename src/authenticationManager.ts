import {
  clientCredentialsGrant,
  Configuration,
  discovery,
  refreshTokenGrant,
  type TokenEndpointResponse,
} from 'openid-client';
import * as grpc from '@grpc/grpc-js';
import { jwtDecode, type JwtPayload } from 'jwt-decode';

/**
 * Options for configuring the AuthenticationManager.
 */
export type AuthenticationOptions = {
  /** OAuth client ID. */
  clientId: string;
  /** OAuth client secret. */
  clientSecret: string;
  /** URL of the OAuth issuer (authorization server). */
  issuerUrl: string;
  /** Whether to automatically refresh the access token. */
  autoRefresh?: boolean;
  /** OAuth scope to request. */
  scope: 'manage:classify';
};

/**
 * Manages OAuth authentication and token refresh for the Athena gRPC client.
 * Handles acquiring and refreshing access tokens using the OAuth client credentials flow.
 */
export class AuthenticationManager {
  private token?: TokenEndpointResponse | undefined;
  private decoded?: JwtPayload;
  private options: AuthenticationOptions;
  private discovery?: Configuration;
  private tokenExpiration?: Date;

  /**
   * Creates a new AuthenticationManager with the provided options.
   * @param options Configuration options for authentication.
   */
  constructor(options: AuthenticationOptions) {
    this.options = options;
  }

  /**
   * Appends the current authentication header to the provided gRPC metadata object.
   * @param metadata The gRPC metadata to which the Authorization header will be added.
   */
  public async appendAuthorizationToMetadata(
    metadata: grpc.Metadata,
  ): Promise<void> {
    metadata.set('Authorization', await this.getAuthenticationHeader());
  }

  /**
   * Returns the current authentication header (e.g., "Bearer <token>"), refreshing the token if necessary.
   * @returns The authentication header string.
   */
  public async getAuthenticationHeader(): Promise<string> {
    await this.maybeRefreshAccessToken();
    if (this.token === undefined) {
      throw new Error('No access token available');
    }

    return `${this.token.token_type} ${this.token.access_token}`;
  }

  /**
   * Handles token refresh logic, including discovery, refresh, and re-acquisition as needed.
   * Refreshes the access token if expired or missing.
   * @private
   */
  private async maybeRefreshAccessToken(): Promise<void> {
    if (this.discovery === undefined) {
      // Discover the OIDC server metadata
      console.info('Discovering OIDC server metadata from for: ', {
        clientId: this.options.clientId,
        issuerUrl: this.options.issuerUrl,
      });
      this.discovery = await discovery(
        new URL(this.options.issuerUrl),
        this.options.clientId,
        this.options.clientSecret,
      );
    }

    if (
      this.tokenExpiration &&
      this.tokenExpiration < new Date() &&
      this.token
    ) {
      if (this.token.refresh_token === undefined) {
        this.token = undefined;
      } else {
        // Attempt to refresh token.
        try {
          this.token = await refreshTokenGrant(
            this.discovery,
            this.token.refresh_token,
          );
          this.decoded = jwtDecode(this.token.access_token);

          // Calculate expiry date of jwt
          if (this.decoded && this.decoded.exp) {
            this.tokenExpiration = new Date(this.decoded.exp * 1000);
          }
        } catch {
          this.token = undefined;
        }
      }
    }

    if (this.token === undefined) {
      this.token = await clientCredentialsGrant(this.discovery, {
        audience: 'crisp-athena-dev',
        scope: this.options.scope,
      });
      this.decoded = jwtDecode(this.token.access_token);

      // Calculate expiry date of jwt
      if (this.decoded && this.decoded.exp) {
        this.tokenExpiration = new Date(this.decoded.exp * 1000);
      }
    }
  }
}
