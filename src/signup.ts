export interface SignupInput {
  name: string;
  email: string;
  password: string;
}

export interface SignupSuccessResult {
  success: true;
  user: {
    name: string;
    email: string;
  };
}

export interface SignupFailureResult {
  success: false;
  errors: {
    name?: string;
    email?: string;
    password?: string;
  };
}

export type SignupResult = SignupSuccessResult | SignupFailureResult;

export function signup(input: SignupInput): SignupResult {
  const errors: { name?: string; email?: string; password?: string } = {};

  if (!input.name || input.name.trim() === '') {
    errors.name = 'Name is required.';
  } else if (input.name.trim().length < 2) {
    errors.name = 'Name must be at least 2 characters long.';
  }

  if (!input.email || input.email.trim() === '') {
    errors.email = 'Email is required.';
  } else if (!/^[^@]+@[^@]+\.[^@]+$/.test(input.email)) {
    errors.email = 'Invalid email format.';
  }

  if (!input.password || input.password.length < 8) {
    errors.password = 'Password must be at least 8 characters long.';
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    user: {
      name: input.name,
      email: input.email,
    },
  };
}
