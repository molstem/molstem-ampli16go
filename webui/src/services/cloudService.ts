// Cloud API service for authentication and device management

export interface CloudUser {
  id: string;
  email: string;
  name: string | null;
  picture_url: string | null;
}

export interface CloudDevice {
  serial_number: string;
  name: string;
  enrolled_at: number;
  last_seen_at: number | null;
  online: boolean;
}

interface AuthMeResponse {
  user: CloudUser;
}

interface DeviceListResponse {
  devices: CloudDevice[];
}

class CloudService {
  private user: CloudUser | null = null;
  private listeners: Set<() => void> = new Set();

  getUser(): CloudUser | null {
    return this.user;
  }

  isLoggedIn(): boolean {
    return this.user !== null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  async checkAuth(): Promise<CloudUser | null> {
    try {
      const response = await fetch('/auth/me', {
        credentials: 'include',
      });

      if (!response.ok) {
        this.user = null;
        this.notify();
        return null;
      }

      const data: AuthMeResponse = await response.json();
      this.user = data.user;
      this.notify();
      return this.user;
    } catch (error) {
      console.error('Failed to check auth:', error);
      this.user = null;
      this.notify();
      return null;
    }
  }

  login(): void {
    // Redirect to Google OAuth - will redirect back after auth
    window.location.href = '/auth/google';
  }

  async logout(): Promise<void> {
    try {
      await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.error('Logout error:', error);
    }
    this.user = null;
    this.notify();
  }

  async getDevices(): Promise<CloudDevice[]> {
    const response = await fetch('/v0/devices', {
      credentials: 'include',
    });

    if (!response.ok) {
      if (response.status === 401) {
        this.user = null;
        this.notify();
      }
      throw new Error('Failed to fetch devices');
    }

    const data: DeviceListResponse = await response.json();
    return data.devices;
  }

  /** Claim a device using the enrollment ID shown on its screen (XXXX-XXXX). */
  async claimEnrollment(enrollmentId: string): Promise<void> {
    const response = await fetch(`/v0/enrollment/${encodeURIComponent(enrollmentId.trim().toUpperCase())}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error(await this.errorMessage(response, 'Failed to add device'));
    }
  }

  /** Unenroll a device from the current account. */
  async removeDevice(serial: string): Promise<void> {
    const response = await fetch(`/v0/devices/${encodeURIComponent(serial)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(await this.errorMessage(response, 'Failed to remove device'));
    }
  }

  private async errorMessage(response: Response, fallback: string): Promise<string> {
    if (response.status === 401) {
      this.user = null;
      this.notify();
      return 'Please sign in again';
    }
    try {
      const err = (await response.json()) as { message?: string };
      return err.message || fallback;
    } catch {
      return fallback;
    }
  }
}

export const cloudService = new CloudService();
