# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Public visitors learning about Malanga Community Welfare and prospective members.
- Welfare members using the member portal and Android companion app.
- Administrators managing welfare operations through the web application.

## Product Purpose

Malanga Community Welfare connects members around shared welfare support and provides web and mobile tools for member access and administration. The website is also the public entry point for joining and accessing the Android companion app.

## Operating Context

The service is for a Kenyan welfare group. The web application is hosted as a Vite site, and the Flutter companion app targets Android among other platforms.

## Capabilities and Constraints

- The public website supports membership applications and member portal access.
- The Android companion app is built from `flt_app/`.
- The website should serve the Android APK from a stable URL on the Malanga website domain.
- The APK signing key must remain private, be excluded from version control, and be retained for future app updates.

## Brand Commitments

- Product name: Malanga Community Welfare / Malanga Welfare.
- Preserve the existing Malanga logo and website visual language.

## Evidence on Hand

- Website and Flutter source code in this repository.
- Existing brand assets in `public/` and `flt_app/assets/branding/`.

## Product Principles

- Make public access to the member app straightforward.
- Keep member and administrator workflows available across web and mobile.
- Protect the signing credentials required to update the Android app.
