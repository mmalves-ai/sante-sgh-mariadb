// M59-F1 (regra 4): a API não sobe em homologação ou produção com a conta do núcleo sendo o administrador do servidor,
// ausente (o padrão é root) ou igual à das migrações. Em dev e CI não confere (o container de dev usa o administrador).
import { describe, expect, it } from 'vitest';
import { recusaDasContasDoBanco } from './partida.js';

describe('recusaDasContasDoBanco', () => {
  it('dev e CI: não confere', () => {
    expect(recusaDasContasDoBanco({ AMBIENTE: 'dev', SGH_MARIADB_USUARIO: 'root' })).toBeNull();
    expect(recusaDasContasDoBanco({ AMBIENTE: 'ci' })).toBeNull();
  });

  it('produção com conta própria: sobe', () => {
    expect(recusaDasContasDoBanco({ AMBIENTE: 'producao', SGH_MARIADB_USUARIO: 'sgh_app' })).toBeNull();
  });

  it('produção com o administrador ou sem a conta: recusa', () => {
    expect(recusaDasContasDoBanco({ AMBIENTE: 'producao', SGH_MARIADB_USUARIO: 'ROOT' })).toMatch(
      /a aplicação não pode usar o administrador do servidor/,
    );
    expect(recusaDasContasDoBanco({ AMBIENTE: 'homologacao' })).toMatch(/SGH_MARIADB_USUARIO ausente/);
  });

  it('a conta das migrações não pode ser a da aplicação', () => {
    expect(
      recusaDasContasDoBanco({
        AMBIENTE: 'producao',
        SGH_MARIADB_USUARIO: 'sgh_app',
        SGH_MARIADB_USUARIO_MIGRACOES: 'SGH_APP',
      }),
    ).toMatch(/conta das migrações/);
  });
});
