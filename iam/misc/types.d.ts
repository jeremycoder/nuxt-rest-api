export type User = {
  id: number;
  first_name: string;
  last_name: string;
  uuid: string;
  email: string;
  password: string;
  role: "ADMIN" | "GENERAL";
  email_verified: boolean;
  last_login: Date | null;
  created_at: Date;
};

export type JSONResponse = {
  status: "success" | "fail";
  data: any;
  error?: any;
};

export type Tokens = {
  accessToken: string;
  refreshToken: string;
};

export type ClientPlatforms = "app" | "browser" | "browser-dev";

export type EmailOptions = {
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
};
