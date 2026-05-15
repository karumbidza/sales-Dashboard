'use client';
import { useEffect } from 'react';

export default function ReadyBeacon() {
  useEffect(() => {
    requestAnimationFrame(() => {
      document.body.setAttribute('data-report-ready', 'true');
    });
  }, []);
  return null;
}
