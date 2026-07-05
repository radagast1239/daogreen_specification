import React from 'react';
import { Link } from 'react-router-dom';
import { buildFrameDrawingLink } from '../../shared/frameDrawingContext.js';

export default function FrameDrawingLinkButton({
  context,
  label = 'Нарисовать схему',
  className = 'btn btn-sm btn-outline',
}) {
  const to = buildFrameDrawingLink(context);
  return (
    <Link to={to} className={className} target="_blank" rel="noreferrer">
      {label}
    </Link>
  );
}
