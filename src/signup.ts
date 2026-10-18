
export interface SignupInput {
  name: string;
  email: string;
  password: string;
}

export function signup(input: SignupInput) {
  
  return {
    success: true,
    user: {
      name: input.name,
      email: input.email,
    },
  };
}
