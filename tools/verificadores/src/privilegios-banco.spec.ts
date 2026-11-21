import { describe, expect, it } from 'vitest';
import { desviosDaConta, nomeDaConta, type PrivilegioBanco } from './privilegios-banco.ts';
import { lerListagemContainers } from './containers.ts';

const p = (
  nivel: PrivilegioBanco['nivel'],
  alvo: string,
  privilegio: string,
  repassa = false,
): PrivilegioBanco => ({
  conta: "'app'@'127.0.0.1'",
  nivel,
  alvo,
  privilegio,
  repassa,
});

describe('privilégios da conta da aplicação no MariaDB', () => {
  it('nome da conta sem o host', () => {
    expect(nomeDaConta("'app'@'%'")).toBe('app');
    expect(nomeDaConta('app')).toBe('app');
  });

  it('só leitura e escrita de linhas no banco do cliente: sem desvio', () => {
    const d = desviosDaConta(
      [p('global', '*', 'USAGE'), p('banco', 'cliente_x', 'SELECT'), p('tabela', 'cliente_x.t', 'UPDATE')],
      'app',
    );
    expect(d).toEqual({ excesso: [], alertas: [] });
  });

  it('global, administração, estrutura e repasse são excesso; DELETE no banco é alerta; outra conta não conta', () => {
    const d = desviosDaConta(
      [
        p('global', '*', 'SELECT'),
        p('banco', 'cliente_x', 'PROCESS'),
        p('banco', 'cliente_x', 'DROP'),
        p('banco', 'cliente_x', 'INSERT', true),
        p('banco', 'cliente_x', 'DELETE'),
        { ...p('banco', 'cliente_x', 'DROP'), conta: "'migracao'@'%'" },
      ],
      'app',
    );
    expect(d.excesso).toHaveLength(4);
    expect(d.alertas).toHaveLength(1);
  });

  it('listagem de containers do docker ps', () => {
    expect(lerListagemContainers('a\t127.0.0.1:1->1/tcp\n\nb\t\n')).toEqual([
      { nome: 'a', portas: '127.0.0.1:1->1/tcp' },
      { nome: 'b', portas: '' },
    ]);
  });
});
