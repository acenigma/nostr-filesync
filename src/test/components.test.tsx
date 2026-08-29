import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Thumbnail from '../components/Thumbnail';
import Unlock from '../components/Unlock';

describe('Thumbnail', () => {
  it('renderiza ícone para tipo não-imagem', () => {
    const { container } = render(
      <Thumbnail
        file={{
          fileId: 'f-1',
          name: 'doc.pdf',
          type: 'application/pdf',
          size: 100,
          hash: '',
          encryptedHash: '',
          chunks: 1,
          headerEventId: '',
          createdAt: 0,
          status: 'remote',
          encrypted: false,
          encKey: null,
          encNonce: null,
          compression: 'none',
          path: '',
        }}
      />
    );
    expect(container.textContent).toContain('📕');
  });

  it('renderiza ícone para image sem carregar nada inicialmente', () => {
    const { container } = render(
      <Thumbnail
        file={{
          fileId: 'f-2',
          name: 'photo.jpg',
          type: 'image/jpeg',
          size: 100,
          hash: '',
          encryptedHash: '',
          chunks: 1,
          headerEventId: '',
          createdAt: 0,
          status: 'remote',
          encrypted: false,
          encKey: null,
          encNonce: null,
          compression: 'none',
          path: '',
        }}
      />
    );
    const span = container.querySelector('.thumb-icon') || container.querySelector('.thumb-wrap');
    expect(span).not.toBeNull();
  });
});

describe('Unlock', () => {
  it('renderiza estado inicial', () => {
    const { container } = render(<Unlock />);
    expect(container.textContent).toMatch(/Loading|Welcome|Create|Verifique|Carregando|Bem-vindo/i);
  });
});