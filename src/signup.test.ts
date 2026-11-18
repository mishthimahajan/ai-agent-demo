import { describe, it, expect } from 'vitest';
import { signup, SignupSuccessResult, SignupFailureResult } from './signup';

describe('signup', () => {
  it('should successfully sign up a user with valid input', () => {
    const input = {
      name: 'John Doe',
      email: 'john.doe@example.com',
      password: 'securepassword123',
    };
    const result = signup(input) as SignupSuccessResult;

    expect(result.success).toBe(true);
    expect(result.user).toEqual({
      name: 'John Doe',
      email: 'john.doe@example.com',
    });
  });

  it('should return an error if name is missing', () => {
    const input = {
      name: '',
      email: 'test@example.com',
      password: 'securepassword123',
    };
    const result = signup(input) as SignupFailureResult;

    expect(result.success).toBe(false);
    expect(result.errors).toEqual({ name: 'Name is required.' });
  });

  it('should return an error if name is whitespace-only', () => {
    const input = {
      name: '   ',
      email: 'test@example.com',
      password: 'securepassword123',
    };
    const result = signup(input) as SignupFailureResult;

    expect(result.success).toBe(false);
    expect(result.errors).toEqual({ name: 'Name is required.' });
  });

  it('should return an error if email is missing', () => {
    const input = {
      name: 'John Doe',
      email: '',
      password: 'securepassword123',
    };
    const result = signup(input) as SignupFailureResult;

    expect(result.success).toBe(false);
    expect(result.errors).toEqual({ email: 'Email is required.' });
  });

  it('should return an error if email is whitespace-only', () => {
    const input = {
      name: 'John Doe',
      email: '   ',
      password: 'securepassword123',
    };
    const result = signup(input) as SignupFailureResult;

    expect(result.success).toBe(false);
    expect(result.errors).toEqual({ email: 'Email is required.' });
  });

  it('should return an error if email format is invalid', () => {
    const input = {
      name: 'John Doe',
      email: 'invalid-email',
      password: 'securepassword123',
    };
    const result = signup(input) as SignupFailureResult;

    expect(result.success).toBe(false);
    expect(result.errors).toEqual({ email: 'Invalid email format.' });
  });

  it('should return an error if password is shorter than 8 characters', () => {
    const input = {
      name: 'John Doe',
      email: 'test@example.com',
      password: 'short',
    };
    const result = signup(input) as SignupFailureResult;

    expect(result.success).toBe(false);
    expect(result.errors).toEqual({ password: 'Password must be at least 8 characters long.' });
  });

  it('should return multiple errors for multiple invalid fields', () => {
    const input = {
      name: '',
      email: 'bad-email',
      password: '123',
    };
    const result = signup(input) as SignupFailureResult;

    expect(result.success).toBe(false);
    expect(result.errors).toEqual({
      name: 'Name is required.',
      email: 'Invalid email format.',
      password: 'Password must be at least 8 characters long.',
    });
  });
});


describe('signup name length validation', () => {
  it('rejects a one-character name', () => {
    const result = signup({
      name: 'J',
      email: 'john@example.com',
      password: 'securepassword123',
    });

    expect(result).toEqual({
      success: false,
      errors: { name: 'Name must be at least 2 characters long.' },
    });
  });

    
  it('rejects an email without a dotted domain', () => {
    const result = signup({
      name: 'John',
      email: 'test@invalid',
      password: 'securepassword123',
    });

    expect(result).toEqual({
      success: false,
      errors: { email: 'Invalid email format.' },
    });
  });
});


describe('signup name length validation', () => {
  it('rejects a one-character name', () => {
    const result = signup({
      name: 'J',
      email: 'john@example.com',
      password: 'securepassword123',
    });

    expect(result).toEqual({
      success: false,
      errors: { name: 'Name must be at least 2 characters long.' },
    });
  });
});


describe('signup empty password validation', () => {
  it('rejects an empty password', () => {
    const result = signup({
      name: 'John',
      email: 'john@example.com',
      password: '',
    });

    expect(result).toEqual({
      success: false,
      errors: {
        password: 'Password must be at least 8 characters long.',
      },
    });
  });
});
