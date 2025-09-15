import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AuthenticationManager,
  type AuthenticationOptions,
} from '../../src/authenticationManager';
import * as openidClient from 'openid-client';
import * as jwtDecodeModule from 'jwt-decode';
import * as grpc from '@grpc/grpc-js';

vi.mock('openid-client');
vi.mock('jwt-decode');

const mockDiscovery = { issuer: 'https://issuer.example.com' } as any;
const mockToken = {
  access_token: 'mock_access_token',
  token_type: 'Bearer',
  refresh_token: 'mock_refresh_token',
} as any;
const mockDecoded = { exp: Math.floor(Date.now() / 1000) + 3600 };

const options: AuthenticationOptions = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  issuerUrl: 'https://issuer.example.com',
  scope: 'manage:classify',
};

describe('AuthenticationManager', () => {
  let manager: AuthenticationManager;

  beforeEach(() => {
    vi.resetAllMocks();
    (openidClient.discovery as any).mockResolvedValue(mockDiscovery);
    (openidClient.clientCredentialsGrant as any).mockResolvedValue(mockToken);
    (openidClient.refreshTokenGrant as any).mockResolvedValue(mockToken);
    (jwtDecodeModule.jwtDecode as any).mockReturnValue(mockDecoded);
    manager = new AuthenticationManager(options);
  });

  it('should discover OIDC configuration and acquire token on first use', async () => {
    await manager.getAuthenticationHeader();
    expect(openidClient.discovery).toHaveBeenCalledWith(
      new URL(options.issuerUrl),
      options.clientId,
      options.clientSecret,
    );
    expect(openidClient.clientCredentialsGrant).toHaveBeenCalledWith(
      mockDiscovery,
      { audience: 'crisp-athena-live', scope: options.scope },
    );
  });

  it('should return a Bearer token in the authentication header', async () => {
    const header = await manager.getAuthenticationHeader();
    expect(header).toBe('Bearer mock_access_token');
  });

  it('should append Authorization to grpc.Metadata', async () => {
    const metadata = new grpc.Metadata();
    await manager.appendAuthorizationToMetadata(metadata);
    expect(metadata.get('Authorization')).toEqual(['Bearer mock_access_token']);
  });

  it('should refresh token if expired and refresh_token is present', async () => {
    // Simulate token already acquired and expired
    await manager.getAuthenticationHeader();
    (manager as any).tokenExpiration = new Date(Date.now() - 1000); // expired
    (manager as any).token.refresh_token = 'mock_refresh_token';
    (openidClient.refreshTokenGrant as any).mockResolvedValue({
      ...mockToken,
      access_token: 'new_access_token',
    });
    (jwtDecodeModule.jwtDecode as any).mockReturnValue({
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const header = await manager.getAuthenticationHeader();
    expect(openidClient.refreshTokenGrant).toHaveBeenCalled();
    expect(header).toBe('Bearer new_access_token');
  });

  it('should reacquire token if expired and no refresh_token', async () => {
    await manager.getAuthenticationHeader();
    (manager as any).tokenExpiration = new Date(Date.now() - 1000); // expired
    (manager as any).token.refresh_token = undefined;
    (openidClient.clientCredentialsGrant as any).mockResolvedValue({
      ...mockToken,
      access_token: 'reacquired_access_token',
    });
    (jwtDecodeModule.jwtDecode as any).mockReturnValue({
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const header = await manager.getAuthenticationHeader();
    expect(openidClient.clientCredentialsGrant).toHaveBeenCalled();
    expect(header).toBe('Bearer reacquired_access_token');
  });

  it('should reacquire token if refresh fails', async () => {
    await manager.getAuthenticationHeader();
    (manager as any).tokenExpiration = new Date(Date.now() - 1000); // expired
    (manager as any).token.refresh_token = 'mock_refresh_token';
    (openidClient.refreshTokenGrant as any).mockRejectedValue(
      new Error('refresh failed'),
    );
    (openidClient.clientCredentialsGrant as any).mockResolvedValue({
      ...mockToken,
      access_token: 'fallback_access_token',
    });
    (jwtDecodeModule.jwtDecode as any).mockReturnValue({
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const header = await manager.getAuthenticationHeader();
    expect(openidClient.refreshTokenGrant).toHaveBeenCalled();
    expect(openidClient.clientCredentialsGrant).toHaveBeenCalled();
    expect(header).toBe('Bearer fallback_access_token');
  });

  it('should only discover once', async () => {
    await manager.getAuthenticationHeader();
    await manager.getAuthenticationHeader();
    expect(openidClient.discovery).toHaveBeenCalledTimes(1);
  });
});
