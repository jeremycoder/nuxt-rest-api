// Helper functions for
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { User, Tokens, EmailOptions } from "~~/iam/misc/types";
import { v4 as uuidv4 } from "uuid";
import jwt, { JwtPayload } from "jsonwebtoken";
import { H3Event, H3Error } from "h3";
import { getClientPlatform } from "../middleware";
import passwordGenerator from "generate-password";
import {
  emailWithNodemailerService,
  emailWithNodemailerSmtp,
  emailWithSendgrid,
} from "./email";

const config = useRuntimeConfig();
const prisma = new PrismaClient();

/**
 * @desc Hashes a password or any string using Argon 2
 * @param password Unhashed password
 */
export async function hashPassword(
  password: string
): Promise<string | H3Error> {
  try {
    return await argon2.hash(password);
  } catch (err) {
    return createError({ statusCode: 500, statusMessage: "Password error" });
  }
}

/**
 * @desc Makes a uuid
 */
export function makeUuid(): string {
  return uuidv4();
}

/**
 * @desc Suite of checks to validate user before registration
 * @param event Event from Api
 * @info returns NuxtError HTTP status code if comething is wrong
 */
export async function validateUserRegistration(
  event: H3Event
): Promise<H3Error | void> {
  const body = await readBody(event);

  // Check if body contains first_name, last_name, email, and password
  const bodyError = await validateRegisterBody(event);
  if (bodyError) {
    return createError({ statusCode: 400, statusMessage: bodyError });
  }

  // Check email is in a valid format
  if (!validateEmail(body.email)) {
    return createError({ statusCode: 400, statusMessage: "Bad email format" });
  }

  // If a user with that email already exists, return error
  const user = await getUserByEmail(body.email);
  if (user)
    return createError({
      statusCode: 409,
      statusMessage: "Email already exists",
    });

  // Check password meets minimum strength requirements
  if (!validatePassword(body.password)) {
    return createError({
      statusCode: 400,
      statusMessage: `Poor password strength. Password must contain at least 8 characters, an upper-case letter, and a lower-case letter, 
        a number, and a non-alphanumeric character.`,
    });
  }
}

/**
 * @desc Suite of checks to validate data before updating user
 * @param event Event from Api
 * @info Expects fromRoute object in event.context.params
 */
export async function validateUserUpdate(
  event: H3Event
): Promise<H3Error | void> {
  const { fromRoute } = event.context.params;
  const body = await readBody(event);

  // If no uuid given
  if (!fromRoute.uuid)
    return createError({
      statusCode: 400,
      statusMessage: "Uuid not supplied",
    });

  // If uuid exists, but user does not exist
  if (!(await userExists(fromRoute.uuid)))
    return createError({
      statusCode: 400,
      statusMessage: "User not found",
    });

  // If first name and last name do not exist in body
  if ("first_name" in body === false && "last_name" in body === false)
    return createError({
      statusCode: 400,
      statusMessage: "No updatable properties supplied",
    });

  // If first_name empty
  if (!body.first_name)
    return createError({
      statusCode: 400,
      statusMessage: "first_name must have data",
    });

  // If last_name empty
  if (!body.last_name)
    return createError({
      statusCode: 400,
      statusMessage: "last_name must have data",
    });
}

/**
 * @desc Suite of checks to validate data before updating user profile
 * @param event Event from Api
 */
export async function validateUserProfileUpdate(
  event: H3Event
): Promise<H3Error | void> {
  const body = await readBody(event);

  // If uuid not provided
  if (!body.uuid)
    return createError({
      statusCode: 400,
      statusMessage: "User uuid not provided",
    });

  const user = await getUserByUuid(body.uuid);
  // This error really shouldn't happen
  if (!user)
    return createError({
      statusCode: 400,
      statusMessage: "User not found",
    });

  // If first name is supplied, but has no value
  if ("first_name" in body === true && body.first_name.trim() === "")
    return createError({
      statusCode: 400,
      statusMessage: "first_name must have a value",
    });

  // If last name is supplied, but has no value
  if ("last_name" in body === true && body.last_name.trim() === "")
    return createError({
      statusCode: 400,
      statusMessage: "last_name must have a value",
    });

  // If either current password or new password is supplied, but not the other one
  if ("new_password" in body === true && "current_password" in body === false)
    return createError({
      statusCode: 400,
      statusMessage: "Both current_password and new_password must be supplied",
    });

  if ("new_password" in body === false && "current_password" in body === true)
    return createError({
      statusCode: 400,
      statusMessage: "Both current_password and new_password must be supplied",
    });

  // If supplied current password does not match password in database
  if ("current_password" in body)
    if (!(await verifyPassword(user.password, body.current_password)))
      return createError({
        statusCode: 400,
        statusMessage: "Wrong current password",
      });

  // If new password is supplied, but fails password strength policy
  if ("new_password" in body === true && !validatePassword(body.new_password))
    return createError({
      statusCode: 400,
      statusMessage: `Poor new password strength. Password must contain at least 8 characters, an upper-case letter, and a lower-case letter, 
      a number, and a non-alphanumeric character.`,
    });
}

/**
 * @desc Suite of checks to validate data before deleting user
 * @param event Event from Api
 * @info Expects fromRoute object in event.context.params
 */
export async function validateUserDelete(
  event: H3Event
): Promise<H3Error | void> {
  const { uuid } = event.context.params.fromRoute;
  if (!uuid)
    return createError({
      statusCode: 400,
      statusMessage: "Uuid not supplied",
    });

  // If uuid exists, but user does not exist
  if (!(await userExists(uuid)))
    return createError({
      statusCode: 400,
      statusMessage: "User not found",
    });
}

/**
 * @desc Suite of checks to validate data before logging user in
 * @param event Event from Api
 */
export async function validateUserLogin(
  event: H3Event
): Promise<H3Error | void> {
  const body = await readBody(event);

  // Check if body contains email, and password
  const bodyError = validateLoginBody(body);
  if (bodyError) {
    return createError({ statusCode: 400, statusMessage: bodyError });
  }

  // Check email is in a valid format
  if (!validateEmail(body.email)) {
    return createError({ statusCode: 400, statusMessage: "Bad email format" });
  }
}

/**
 * @desc Suite of checks to validate data before issuing refresh token
 * @param event Event from Api
 */
export async function getRefreshTokens(
  event: H3Event
): Promise<H3Error | Tokens> {
  // TODO: Need to check based on platform
  // TODO: If platform is app, get from authorization header
  // TODO: If platform is browser, get from cookies

  let refreshToken = null;

  // Get client platform
  const errorOrPlatform = getClientPlatform(event);
  if (errorOrPlatform instanceof H3Error) return errorOrPlatform;

  // If app, get token from header
  const platform = errorOrPlatform as string;
  if (platform === "app")
    // If browser, get token from cookies
    refreshToken = event.node.req.headers["refresh-token"] as string;
  else if (["browser", "browser-dev"].includes(platform))
    refreshToken = getCookie(event, "refresh-token") as string;

  // If no token, user is not authenticated
  if (!refreshToken) {
    console.log("Error: No refresh token provided");
    return createError({
      statusCode: 400,
      statusMessage: "No refresh token provided",
    });
  }

  // Get Bearer token
  const bearerToken = refreshToken.split(" ");

  // Check for word "Bearer"
  if (bearerToken[0] !== "Bearer") {
    console.log("Missing word 'Bearer' in token");
    return createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }

  // Check for token
  if (!bearerToken[1]) {
    console.log("Missing token");
    return createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }

  // Get user from token
  const errorOrUser = await verifyRefreshToken(bearerToken[1]);

  // Check if user was retrieved from token
  if (errorOrUser instanceof H3Error) {
    console.log("Failed to retrieve user from token");
    return createError({
      statusCode: 403,
      statusMessage: "Forbidden",
    });
  }

  const user = errorOrUser as User;

  // Check if user has email attribute
  if (!user.email)
    return createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });

  // Check if user exists in the database
  const userInDb = await getUserByEmail(user.email);

  if (userInDb === null) {
    console.log("User not found in database");
    return createError({
      statusCode: 403,
      statusMessage: "Forbidden",
    });
  }

  // Get new access and refresh tokens
  const errorOrTokens = createNewTokensFromRefresh(bearerToken[1]);
  if (errorOrTokens instanceof H3Error) return errorOrTokens;

  const tokens = (await errorOrTokens) as Tokens;
  return tokens;
}

/**
 * @desc Checks whether the body in register post request is in correct format
 * @param body Body object passed in register post request
 */
export async function validateRegisterBody(event: H3Event) {
  const body = await readBody(event);
  if ("first_name" in body === false || body.first_name.trim() == "") {
    return "'first_name' is required";
  }

  if ("last_name" in body === false || body.last_name.trim() == "") {
    return "'last_name' is required";
  }

  if ("email" in body === false) {
    return "'email' is required";
  }

  if ("password" in body === false) {
    return "'password' is required";
  }
}

/**
 * @desc Checks whether the body in login post request is in correct format
 * @param body Body object passed in login post request
 */
export function validateLoginBody(body: Object) {
  if ("email" in body === false) {
    return "'email' is required";
  }

  if ("password" in body === false) {
    return "'password' is required";
  }
}

/**
 * @desc Checks whether email is valid
 * @param email The email string
 */
export function validateEmail(email: string): boolean {
  if (/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(email)) {
    return true;
  }

  return false;
}

/**
 * @desc Checks whether email already exists in database
 * @param email The email string
 */
// TODO: This needs to return errors or boolean
// TODO: Database errors are being masked and it's hard to debug
export async function emailExists(email: string): Promise<boolean | H3Error> {
  if (!email) return false;
  let error = null;

  let user = undefined;
  await prisma.users
    .findFirst({
      where: {
        email: email,
      },
    })
    .then(async (result) => {
      user = result;
    })
    .catch(async (e) => {
      console.error(e);
      error = e;
    });

  // If error, return error
  if (error) {
    console.log("Email error when checking if email exists");
    return createError({
      statusCode: 500,
      statusMessage: "Server error",
    });
  }

  // if user does not exist, return false
  if (user === null) {
    console.log("User not found");
    return false;
  }

  // Otherwise user exists, return true
  return true;
}

/**
 * @desc Checks whether user exists in database using uuid
 * @param uuid User's uuid
 * @return { Promise<boolean> }
 */
export async function userExists(uuid: string): Promise<boolean> {
  if (!uuid) return false;

  let user = undefined;

  await prisma.users
    .findFirst({
      where: {
        uuid: uuid,
      },
    })
    .then(async (result) => {
      user = result;
    })
    .catch(async (e) => {
      console.error(e);
    });

  if (user === null) return false;

  return true;
}

/**
 * @desc Checks whether password matches a certain strength
 * @param password User's password
 * @return { <boolean> }
 */
export function validatePassword(password: string): boolean {
  // Has at least 8 characters
  if (password.length <= 8) return false;

  // Has uppercase letters
  if (!/[A-Z]/.test(password)) return false;

  // Has lowercase letters
  if (!/[a-z]/.test(password)) return false;

  // Has numbers
  if (!/\d/.test(password)) return false;

  // Has non-alphanumeric characters
  if (!/\W/.test(password)) return false;

  return true;
}

/**
 * @desc Returns user by email
 * @param email User's email
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  let user = null;
  await prisma.users
    .findFirst({
      where: {
        email: email,
      },
    })
    .then(async (response) => {
      user = response;
    })
    .catch(async (e) => {
      console.error(e);
    });

  return user;
}

/**
 * @desc Returns user by user's uuid
 * @param uuid User's uuid
 */
export async function getUserByUuid(uuid: string): Promise<User | null> {
  let user = null;
  await prisma.users
    .findFirst({
      where: {
        uuid: uuid,
      },
    })
    .then(async (response) => {
      user = response;
    })
    .catch(async (e) => {
      console.error(e);
    });

  return user;
}

/**
 * @desc Updates user's last login value
 * @param email User's email
 */
async function updateLastLogin(email: string): Promise<null | User> {
  let result = null;
  await prisma.users
    .update({
      where: {
        email: email,
      },
      data: {
        last_login: new Date(),
      },
    })
    .then(async (response) => {
      result = response;
    })
    .catch(async (e) => {
      console.error(e);
    });

  return result;
}

/**
 * @desc Verifies password against a hash
 * @param hash Hashed password
 * @param password Unhashed password
 */
async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  try {
    if (await argon2.verify(hash, password)) {
      return true;
    } else {
      return false;
    }
  } catch (err) {
    console.log(err);
    return false;
  }
}

/**
 * @desc Verifies user after token is passed
 * @param token JSON web token
 */
export function verifyAccessToken(token: string): H3Error | JwtPayload {
  let error = null;
  let tokenExpiredError = null;
  let jwtUser = null;

  jwt.verify(token, config.iamAccessTokenSecret, (err, user) => {
    if (err) {
      console.log(err);

      // If access token expired, return for attempt to reauthenticate
      if (err instanceof jwt.TokenExpiredError) {
        console.log("Expired access token");
        console.log("Attempt reauthentication");
        tokenExpiredError = err;
      }

      // If not, just return the error
      error = createError({
        statusCode: 401,
        statusMessage: "Unauthorized",
      });
    } else {
      jwtUser = user as JwtPayload;
    }
  });

  // Check token expiration error first
  if (tokenExpiredError) return tokenExpiredError;

  // If other error, return error
  if (error)
    return createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });

  // If token was valid and we got back a user, return the user
  if (jwtUser) return jwtUser;

  // Otherwise return the error
  return createError({
    statusCode: 401,
    statusMessage: "Unauthorized",
  });
}

/**
 * @desc Verifies reset password token
 * @param token JSON web token
 */
export function verifyResetToken(token: string): H3Error | JwtPayload {
  let error = null;
  let tokenExpiredError = null;
  let jwtUser = null;

  jwt.verify(token, config.iamResetTokenSecret, (err, user) => {
    if (err) {
      console.log(err);

      // If reset token expired, return error
      if (err instanceof jwt.TokenExpiredError) {
        console.log("Expired password reset token");
        tokenExpiredError = err;
      }

      // If not, just return the error
      error = createError({
        statusCode: 401,
        statusMessage: "Unauthorized",
      });
    } else {
      jwtUser = user as JwtPayload;
    }
  });

  // Check token expiration error first
  if (tokenExpiredError) return tokenExpiredError;

  // If other error, return error
  if (error)
    return createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });

  // If token was valid and we got back a user, return the user
  if (jwtUser) return jwtUser;

  // Otherwise return the error
  return createError({
    statusCode: 401,
    statusMessage: "Unauthorized",
  });
}

/**
 * @desc Creates new tokens given a valid refresh token
 * @param token JSON web token
 */
export async function createNewTokensFromRefresh(
  token: string
): Promise<Tokens | H3Error> {
  const errorOrUser = await verifyRefreshToken(token);
  if (errorOrUser instanceof H3Error) return errorOrUser;

  const user = errorOrUser as User;

  const publicUser = {
    uuid: user?.uuid,
    email: user?.email,
    role: user?.role,
  };

  if (user) {
    // Create access and refresh tokens
    const accessToken = jwt.sign(publicUser, config.iamAccessTokenSecret, {
      expiresIn: "15m",
    });

    const refreshTokenId = makeUuid();
    const refreshToken = jwt.sign(publicUser, config.iamRefreshTokenSecret, {
      expiresIn: "14d",
      issuer: "NuxtIam",
      jwtid: refreshTokenId,
    });

    // Deactivate current token
    const deactivateTokenError = await deactivateRefreshTokens(user.id);
    if (deactivateTokenError) return deactivateTokenError;

    // Store tokens
    const storeTokenError = await _storeRefreshToken(refreshTokenId, user.id);
    if (storeTokenError) return storeTokenError;

    return {
      accessToken: accessToken,
      refreshToken: refreshToken,
    };
  }

  console.log("Error creating tokens");
  return createError({
    statusCode: 500,
    statusMessage: "Server error",
  });
}

/**
 * @desc Checks if refresh token is active
 * @param tokenId Token's id
 */
async function _refreshTokenActive(tokenId: string): Promise<H3Error | void> {
  let error = null;

  await prisma.refresh_tokens
    .findFirstOrThrow({
      where: {
        token_id: tokenId,
        is_active: true,
      },
    })
    .then(async () => {})
    .catch(async (e) => {
      console.error(e);
      error = e;
    });

  if (error)
    return createError({ statusCode: 500, statusMessage: "Server error" });
}

/**
 * @desc Verifies refresh token
 * @param token JSON web token
 */
// TODO: Fix bug, should return H3Error or void
export async function verifyRefreshToken(
  token: string
): Promise<H3Error | User> {
  let error = null;
  let verifiedUser = null;
  let verifiedTokenPayload = null as JwtPayload | null;

  jwt.verify(token, config.iamRefreshTokenSecret, async (err, token) => {
    if (err) {
      console.log(err);
      error = createError({
        statusCode: 403,
        statusMessage: "Forbidden",
      });
    }

    // Get verified token
    verifiedTokenPayload = token as JwtPayload;
  });

  if (error) return error;

  if (verifiedTokenPayload) {
    // Checks for token issuer
    if (verifiedTokenPayload.iss !== "NuxtIam") {
      console.log("Token issuer unknown");
      return createError({
        statusCode: 403,
        statusMessage: "Forbidden",
      });
    }

    // Get token id
    const tokenId = verifiedTokenPayload.jti;

    // Checks for token id
    if (!tokenId) {
      console.log("Token id not found");
      return createError({
        statusCode: 403,
        statusMessage: "Forbidden",
      });
    }

    // Checks if refresh token is active
    const tokenNotActiveError = await _refreshTokenActive(tokenId);
    if (tokenNotActiveError) {
      console.log("Token not active");

      // This indicates a stolen token therefore deactivate all refresh tokens
      console.log("Detecting a stolen refresh token");
      const user = await getUserByEmail(verifiedTokenPayload.email);

      if (!user) {
        console.log("User not found from verified refresh token");
        console.log("This should not happen. Please check system integrity.");
        return createError({
          statusCode: 403,
          statusMessage: "Forbidden",
        });
      }

      // Deactivate all user's refresh tokens
      console.log(
        `Attempt to deactivate all user:${user.email}'s refresh tokens`
      );
      const deactivateError = await deactivateRefreshTokens(user.id);

      if (deactivateError) {
        console.log(
          `Deactivate all user:${user.email}'s refresh tokens failed`
        );
        console.log(
          `Should attempt to lock user's account if feature is available`
        );

        return deactivateError;
      }
      console.log(
        `All user:${user.email}'s refresh tokens deactivated. User must login`
      );
      return tokenNotActiveError;
    }

    // Try to get user by email
    const user = await getUserByEmail(verifiedTokenPayload.email);
    if (!user) {
      console.log("Failed to return user by email");
      return createError({
        statusCode: 403,
        statusMessage: "Forbidden",
      });
    }

    verifiedUser = user;
  }

  if (verifiedUser) return verifiedUser;

  return createError({
    statusCode: 403,
    statusMessage: "Forbidden",
  });
}

/**
 * @desc Stores refresh token in database
 * @param tokenId Token's id
 * @param userId User's id
 */
async function _storeRefreshToken(
  tokenId: string,
  userId: number
): Promise<H3Error | void> {
  let error = null;
  await prisma.refresh_tokens
    .create({
      data: {
        token_id: tokenId,
        user_id: userId,
        is_active: true,
      },
    })
    .then(async () => {})
    .catch(async (e) => {
      console.error(e);
      error = e;
    });

  if (error)
    return createError({ statusCode: 500, statusMessage: "Server error" });
}

/**
 * @desc Deactivates a user's refresh tokens in database
 * @param userId User's id
 */
export async function deactivateRefreshTokens(
  userId: number
): Promise<H3Error | void> {
  let error = null;
  await prisma.refresh_tokens
    .updateMany({
      where: {
        user_id: userId,
      },
      data: {
        is_active: false,
      },
    })
    .then(async () => {})
    .catch(async (e) => {
      console.error(e);
      error = e;
    });

  if (error)
    return createError({ statusCode: 500, statusMessage: "Server error" });
}

/**
 * @desc Authenticates user
 * @param event Event from Api
 */
export async function login(event: H3Event): Promise<H3Error | Tokens> {
  const body = await readBody(event);

  if (!body)
    return createError({
      statusCode: 401,
      statusMessage: "No email or password provided",
    });

  const user = await getUserByEmail(body.email);

  if (user === null) {
    return createError({ statusCode: 401, statusMessage: "Invalid login" });
  }

  if (await verifyPassword(user.password, body.password)) {
    updateLastLogin(user.email);

    const publicUser = {
      uuid: user.uuid,
      email: user.email,
      role: user.role,
    };

    // Create access tokens
    const accessToken = jwt.sign(publicUser, config.iamAccessTokenSecret, {
      expiresIn: "15m",
      issuer: "NuxtIam",
      jwtid: makeUuid(),
    });

    // Create new tokens
    const tokenId = makeUuid();
    const refreshToken = jwt.sign(publicUser, config.iamRefreshTokenSecret, {
      expiresIn: "14d",
      issuer: "NuxtIam",
      jwtid: tokenId,
    });

    // Deactivate any other tokens
    const deactivateTokenError = await deactivateRefreshTokens(user.id);
    if (deactivateTokenError) return deactivateTokenError;

    // Store tokens
    const storeTokenError = await _storeRefreshToken(tokenId, user.id);
    if (storeTokenError) return storeTokenError;

    return {
      accessToken: accessToken,
      refreshToken: refreshToken,
    };
  }

  return createError({ statusCode: 401, statusMessage: "Invalid login" });
}

/**
 * @desc Logs a user out
 * @param event Event from Api
 */
export async function logout(event: H3Event): Promise<H3Error | void> {
  // Attempt to get refresh tokens from cookies
  let refreshToken = null;
  refreshToken = event;

  // Delete access and refresh cookies
  deleteCookie(event, "access-token");
  deleteCookie(event, "refresh-token");

  const body = await readBody(event);

  if (body) {
    const user = await getUserByEmail(body.email);

    // Check if email is provided
    if ("email" in body === false) {
      console.log("Email not found in body for logging out");
      return createError({
        statusCode: 400,
        statusMessage: "User email required",
      });
    }

    // If email is provided but user not found
    if (!user) {
      console.log("User not found for logging out");
      return createError({
        statusCode: 500,
        statusMessage: "Logout failed. User not found.",
      });
    }

    // Deactivate all refresh tokens
    const deactivateError = await deactivateRefreshTokens(user.id);
    if (deactivateError) {
      console.log(`Failed to deactivate user:${user.email}'s refresh tokens`);
      return createError({
        statusCode: 500,
        statusMessage: "Logout failed.",
      });
    }
  }

  // Not sure how to log out in app
}

/**
 * @desc Update user profile
 * @param event H3Event
 */
export async function updateUserProfile(
  event: H3Event
): Promise<User | H3Error> {
  const errorOrVoid = await validateUserProfileUpdate(event);
  if (errorOrVoid instanceof H3Error) return errorOrVoid;

  // After going through validateUserProfileUpdate, supplied values should be clean
  const body = await readBody(event);

  let user = {} as User;
  let error = null;

  // Get current user data
  const userDataOrError = await getUserByUuid(body.uuid);
  if (userDataOrError instanceof H3Error) return userDataOrError;
  const userData = userDataOrError as User;

  // Update user data if they are supplied
  /**
   * @desc Compares two string values and returns the updated valid value
   * @param oldValue The old or current value
   * @param newValue The new value
   * @returns {string}
   */
  function updateOrKeep(oldValue: string, newValue: string): string {
    // If new value is empty string, keep old value
    if (newValue.trim().length === 0) return oldValue.trim();

    // If new value is same as old value, keep old value
    if (newValue.trim() === oldValue.trim()) return oldValue.trim();

    // Otherwise return new value
    return newValue.trim();
  }

  // Attempt to hash new password, if error, return error
  let newHashedPassword = "";
  if ("new_password" in body === true && "current_password" in body === true) {
    const newHashedPasswordOrError = await hashPassword(body.new_password);
    if (newHashedPasswordOrError instanceof H3Error)
      return newHashedPasswordOrError;
    newHashedPassword = newHashedPasswordOrError as string;
  }

  // Update values
  const updatedFirstName = updateOrKeep(userData.first_name, body.first_name);
  const updatedLastName = updateOrKeep(userData.last_name, body.last_name);

  await prisma.users
    .update({
      where: {
        uuid: body.uuid,
      },
      data: {
        first_name: updatedFirstName,
        last_name: updatedLastName,
        // If we got a new password, update it, otherwise keep old password
        password:
          newHashedPassword.length > 0 ? newHashedPassword : user.password,
      },
    })
    .then(async (response) => {
      user = response;
    })
    .catch(async (e) => {
      console.error(e);
      error = e;
    });

  // If error, return error
  if (error) return error;

  return user;
}

/**
 * @desc Send email to reset user password
 * @param user User's profile
 * @param token Reset token
 */
export async function sendResetEmail(
  user: User,
  token: string
): Promise<H3Error | true> {
  const emailers = ["nodemailer-service", "nodemailer-smtp", "sendgrid"];
  console.log("Preparing to send reset email");

  // Get emailer and url
  const emailer = config.iamEmailer;
  const url = config.iamPublicUrl;

  // nodemailer-service
  const service = config.iamNodemailerService;
  const serviceSender = config.iamNodemailerServiceSender;
  const servicePassword = config.iamNodemailerServicePassword;

  // nodemailer-smtp
  const smtpHost = config.iamNodemailerSmtpHost;
  const smtpPort = config.iamNodemailerSmtpPort;
  const smtpSender = config.iamNodemailerSmtpSender;
  const smtpPassword = config.iamNodemailerSmtpPassword;

  // Check if emailer is valid
  if (!emailers.includes(emailer)) {
    console.log(
      `Error: Emailer: ${emailer} is an unknown emailer. Aborting send.`
    );
    return createError({
      statusCode: 500,
      statusMessage: "Server error",
    });
  }

  // Common email options
  const options = {
    to: user.email,
    subject: "Nuxt IAM reset password link",
    text: `
    Hello ${user.first_name},
    You requested to reset your password. Please follow the link below. If you did not request to reset your password, 
    disregard this email. Your last login time was: ${user.last_login}.
      
    This is a one-time password link that will reveal a temporary password.
  
    Password reset link: ${url}/iam/verify?token=${token}
    `,
    html: `
    <p>Hello ${user.first_name}</p>,
    <p>You requested to reset your password. Please follow the link below. If you did not request to reset your password, 
    disregard this email. Your last login time was: ${user.last_login}.</p>
    <p>This is a one-time password link that will reveal a temporary password.</p>
    <p>Password reset link: ${url}/iam/verify?token=${token}</p>`,
  } as EmailOptions;

  // Sending with nodemailer-service
  if (emailer === "nodemailer-service") {
    //Options to do with nodemailer-service
    const serviceOptions = options;
    serviceOptions.from = serviceSender;

    // Attempt to send
    const errorOrSent = await emailWithNodemailerService(
      serviceSender,
      servicePassword,
      service,
      serviceOptions
    );

    // If error, return error
    if (errorOrSent instanceof H3Error) return errorOrSent;

    // Otherwise its true
    return true;
  }

  // Sending with nodemailer-smtp
  if (emailer === "nodemailer-smtp") {
    //Options to do with nodemailer-smtp
    const smtpOptions = options;
    smtpOptions.from = smtpSender;

    // Attempt to send email
    const errorOrSent = await emailWithNodemailerSmtp(
      smtpSender,
      smtpPassword,
      smtpHost,
      smtpPort,
      smtpOptions
    );

    // If error, return error
    if (errorOrSent instanceof H3Error) return errorOrSent;

    // Otherwise its true
    return true;
  }

  // Sending with Sendgrid
  if (emailer === "sendgrid") {
    const sendgridOptions = options;
    sendgridOptions.from = config.iamSendgridSender;
    const errorOrSent = await emailWithSendgrid(options);

    // If error, return error
    if (errorOrSent instanceof H3Error) return errorOrSent;

    // Otherwise its true
    return true;
  }

  // Otherwise return error
  console.log("We should not get here");
  return createError({
    statusCode: 500,
    statusMessage: "Server error",
  });
}

/**
 * @desc Send email to verify user's email
 * @param user User's profile
 * @param token Verify token
 */
export async function sendVerifyEmail(
  user: User,
  token: string
): Promise<H3Error | true> {
  const emailers = ["nodemailer-service", "nodemailer-smtp", "sendgrid"];
  console.log("Preparing to send verification email");

  // Get emailer and url
  const emailer = config.iamEmailer;
  const url = config.iamPublicUrl;

  // nodemailer-service
  const service = config.iamNodemailerService;
  const serviceSender = config.iamNodemailerServiceSender;
  const servicePassword = config.iamNodemailerServicePassword;

  // nodemailer-smtp
  const smtpHost = config.iamNodemailerSmtpHost;
  const smtpPort = config.iamNodemailerSmtpPort;
  const smtpSender = config.iamNodemailerSmtpSender;
  const smtpPassword = config.iamNodemailerSmtpPassword;

  // Check if emailer is valid
  if (!emailers.includes(emailer)) {
    console.log(
      `Error: Emailer: ${emailer} is an unknown emailer. Aborting send.`
    );
    return createError({
      statusCode: 500,
      statusMessage: "Server error",
    });
  }

  // Common email options
  const options = {
    to: user.email,
    subject: "Nuxt IAM please verify your email",
    text: `
    Hello ${user.first_name},
    You recently created an account at ${url} on ${user.created_at}. Please verify your email to continue with your account. Please follow the link below to verify your email. 
      
    Follow the link to verify your email: ${url}/iam/verifyemail?token=${token}
    `,
    html: `
    <p>Hello ${user.first_name}</p>,
    <p>You recently created an account at ${url} on ${user.created_at}. Please verify your email to continue with your account. Please follow the link below to verify your email.</p> 
      
    <p>Follow the link to verify your email: ${url}/iam/verifyemail?token=${token}</p>`,
  } as EmailOptions;

  // Sending with nodemailer-service
  if (emailer === "nodemailer-service") {
    //Options to do with nodemailer-service
    const serviceOptions = options;
    serviceOptions.from = serviceSender;

    // Attempt to send
    const errorOrSent = await emailWithNodemailerService(
      serviceSender,
      servicePassword,
      service,
      serviceOptions
    );

    // If error, return error
    if (errorOrSent instanceof H3Error) return errorOrSent;

    // Otherwise its true
    return true;
  }

  // Sending with nodemailer-smtp
  if (emailer === "nodemailer-smtp") {
    //Options to do with nodemailer-smtp
    const smtpOptions = options;
    smtpOptions.from = smtpSender;

    // Attempt to send email
    const errorOrSent = await emailWithNodemailerSmtp(
      smtpSender,
      smtpPassword,
      smtpHost,
      smtpPort,
      smtpOptions
    );

    // If error, return error
    if (errorOrSent instanceof H3Error) return errorOrSent;

    // Otherwise its true
    return true;
  }

  // Sending with Sendgrid
  if (emailer === "sendgrid") {
    const sendgridOptions = options;
    sendgridOptions.from = config.iamSendgridSender;
    const errorOrSent = await emailWithSendgrid(options);

    // If error, return error
    if (errorOrSent instanceof H3Error) return errorOrSent;

    // Otherwise its true
    return true;
  }

  // Otherwise return error
  console.log("We should not get here");
  return createError({
    statusCode: 500,
    statusMessage: "Server error",
  });
}

/**
 * @Desc Generates a new password for user given user's uuid
 * @param uuid User's uuid
 * @returns {Promise<H3Error|string>} Returns generated password or error
 */
export async function generateNewPassword(
  uuid: string
): Promise<H3Error | string> {
  let error = null;

  // Generate secure password consistent with password policy
  const password = passwordGenerator.generate({
    length: 20,
    numbers: true,
    symbols: true,
    strict: true,
  });

  // Check if password passes password policy
  const isValidPassword = validatePassword(password);
  if (!isValidPassword) {
    console.log("Failed to generate valid password");
    return createError({
      statusCode: 500,
      statusMessage: "Server error",
    });
  }

  // Hash password
  const errorOrHashedPassword = await hashPassword(password);
  if (errorOrHashedPassword instanceof H3Error) {
    console.log("Error hashing password");
    return createError({
      statusCode: 500,
      statusMessage: "Server error",
    });
  }

  const hashedPassword = errorOrHashedPassword as string;

  // Update database
  await prisma.users
    .update({
      where: {
        uuid: uuid,
      },
      data: {
        password: hashedPassword,
      },
    })
    .catch(async (e) => {
      console.error(e);
      error = e;
    });

  // Check for database errors
  if (error) {
    console.log("Error updating user password");
    return createError({
      statusCode: 500,
      statusMessage: "Server error",
    });
  }

  console.log("Updated user password");
  return password;
}

/**
 * @Desc Attempts to add one time token to table, if successful returns the same token id
 * @param tokenId Token's uuid
 * @param expiresAt Date and time when token expires
 * @returns {Promise<H3Error|string>} Returns error or the given uuid
 */
export async function addOneTimeToken(
  tokenId: string,
  expiresAt: Date
): Promise<H3Error | string> {
  let error = null;

  // Update database
  await prisma.one_time_tokens
    .create({
      data: {
        token_id: tokenId,
        expires_at: expiresAt,
      },
    })
    .catch(async (e) => {
      console.error(e);
      error = e;
    });

  // Check for database errors
  if (error) {
    console.log("Error adding one time token");
    return createError({
      statusCode: 500,
      statusMessage: "Server error",
    });
  }

  console.log("One time token added successfully");
  return tokenId;
}

/**
 * @desc Returns JWT payload if token is valid, otherwise returns an error
 * @param token JSON web token
 * @param type Assigned token types
 */
export function getTokenPayload(
  token: string,
  type: "access" | "refresh" | "reset"
): H3Error | JwtPayload {
  let error = null;
  const tokenTypes = ["access", "refresh", "reset"];
  let tokenSecret = "";
  let tempPayload = null;
  let payload = null;

  // If incorrect token type, return error
  if (!tokenTypes.includes(type)) {
    console.log("Invalid token type");
    return (error = createError({
      statusCode: 500,
      statusMessage: "Serve error",
    }));
  }

  // Check token type
  switch (type) {
    case "access":
      tokenSecret = config.iamAccessTokenSecret;
      break;
    case "refresh":
      tokenSecret = config.iamRefreshTokenSecret;
      break;
    case "reset":
      tokenSecret = config.iamResetTokenSecret;
      break;
  }

  // Get token payload
  jwt.verify(token, tokenSecret, (err, jwtPayload) => {
    if (err) {
      console.log(err);

      // If not, just return the error
      error = createError({
        statusCode: 500,
        statusMessage: "Server error",
      });
    } else {
      tempPayload = jwtPayload;
    }
  });

  // Check for errors
  if (error) return error;

  // Otherwise return Jwt payload
  if (tempPayload) {
    console.log("Jwt payload obtained successfully");
    payload = tempPayload as JwtPayload;
    return payload;
  }

  // Return error (to satisfy Typescript demannds)
  console.log("We should never reach here");
  return createError({
    statusCode: 500,
    statusMessage: "Server error",
  });
}
