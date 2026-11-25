import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PasswordStrengthBar, calculateStrength } from '../../src/components/PasswordStrengthBar';

describe('calculateStrength', () => {
  it('returns level 0 for empty password', () => {
    const result = calculateStrength('');
    expect(result.level).toBe(0);
  });

  it('returns level 1 (Weak) for passwords under 8 chars', () => {
    const result = calculateStrength('abc123');
    expect(result.level).toBe(1);
    expect(result.label).toBe('Weak');
    expect(result.color).toBe('error');
  });

  it('returns level 2 (Fair) for passwords 8-11 chars', () => {
    const result = calculateStrength('password1');
    expect(result.level).toBe(2);
    expect(result.label).toBe('Fair');
    expect(result.color).toBe('warning');
  });

  it('returns level 3 (Good) for passwords 12+ chars', () => {
    const result = calculateStrength('mylongpassword');
    expect(result.level).toBe(3);
    expect(result.label).toBe('Good');
    expect(result.color).toBe('info');
  });

  it('returns level 3 (Good) for 8+ chars with mixed case and numbers', () => {
    const result = calculateStrength('Pass1234');
    expect(result.level).toBe(3);
    expect(result.label).toBe('Good');
  });

  it('returns level 4 (Strong) for 12+ chars with all character types', () => {
    const result = calculateStrength('MyP@ssword123');
    expect(result.level).toBe(4);
    expect(result.label).toBe('Strong');
    expect(result.color).toBe('success');
  });

  it('does not return Strong without symbols', () => {
    const result = calculateStrength('MyPassword1234');
    expect(result.level).toBe(3);
    expect(result.label).not.toBe('Strong');
  });

  it('does not return Strong without uppercase', () => {
    const result = calculateStrength('myp@ssword123');
    expect(result.level).toBeLessThan(4);
  });

  it('does not return Strong without lowercase', () => {
    const result = calculateStrength('MYP@SSWORD123');
    expect(result.level).toBeLessThan(4);
  });

  it('does not return Strong without numbers', () => {
    const result = calculateStrength('MyP@sswordABC');
    expect(result.level).toBeLessThan(4);
  });
});

describe('PasswordStrengthBar', () => {
  it('renders nothing for empty password', () => {
    const { container } = render(<PasswordStrengthBar password="" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders strength indicator for weak password', () => {
    render(<PasswordStrengthBar password="abc123" />);
    expect(screen.getByText('Weak')).toBeInTheDocument();
  });

  it('renders strength indicator for fair password', () => {
    render(<PasswordStrengthBar password="password1" />);
    expect(screen.getByText('Fair')).toBeInTheDocument();
  });

  it('renders strength indicator for good password', () => {
    render(<PasswordStrengthBar password="mylongpassword" />);
    expect(screen.getByText('Good')).toBeInTheDocument();
  });

  it('renders strength indicator for strong password', () => {
    render(<PasswordStrengthBar password="MyP@ssword123" />);
    expect(screen.getByText('Strong')).toBeInTheDocument();
  });

  it('shows hint text', () => {
    render(<PasswordStrengthBar password="abc123" />);
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
  });
});
