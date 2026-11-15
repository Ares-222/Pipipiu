// Telegram Bot API client types (minimal subset we use).

export interface TgUser { id: number; is_bot?: boolean; first_name?: string; username?: string; }

export interface TgChat { id: number; type: string; first_name?: string; username?: string; title?: string; }

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  web_app_data?: { data: string; button_text: string };
  successful_payment?: unknown;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
  my_chat_member?: { chat: TgChat; from: TgUser; date: number; new_chat_member: { status: string } };
}

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
  web_app?: { url: string };
}

export interface InlineKeyboardMarkup { inline_keyboard: InlineKeyboardButton[][]; }

export interface TgApiResult<T> { ok: boolean; result?: T; error_code?: number; description?: string; }
