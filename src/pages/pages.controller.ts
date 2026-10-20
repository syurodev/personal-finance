import { readFileSync } from 'node:fs';
import { Controller, Get, Header } from '@nestjs/common';

const asset = (name: string): string => readFileSync(new URL(`./assets/${name}`, import.meta.url), 'utf8');

const LOGIN_HTML = asset('login.html');
const CONSENT_HTML = asset('consent.html');
const LOGIN_JS = asset('login.js');
const CONSENT_JS = asset('consent.js');
const STYLE_CSS = asset('style.css');

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
  "form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

@Controller()
export class PagesController {
  @Get('login')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Content-Security-Policy', CSP)
  @Header('Cache-Control', 'no-store')
  login(): string {
    return LOGIN_HTML;
  }

  @Get('consent')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Content-Security-Policy', CSP)
  @Header('Cache-Control', 'no-store')
  consent(): string {
    return CONSENT_HTML;
  }

  @Get('assets/login.js')
  @Header('Content-Type', 'text/javascript; charset=utf-8')
  loginScript(): string {
    return LOGIN_JS;
  }

  @Get('assets/consent.js')
  @Header('Content-Type', 'text/javascript; charset=utf-8')
  consentScript(): string {
    return CONSENT_JS;
  }

  @Get('assets/style.css')
  @Header('Content-Type', 'text/css; charset=utf-8')
  style(): string {
    return STYLE_CSS;
  }
}
