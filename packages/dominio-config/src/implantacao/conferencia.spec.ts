import { ITENS_CONFERENCIA_INSTALACAO, type ConexaoConferida } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  conferirScripts,
  type EntradaConferenciaInstalacao,
  itensDaConferencia,
  situacaoDaConferencia,
  TETO_PENDENTES_LISTADOS,
} from './conferencia.js';

const H = (c: string) => c.repeat(64);

const conexaoBoa: ConexaoConferida = {
  versaoMotor: '3.0.14',
  charsetBanco: 'NONE',
  charsetConexao: 'NONE',
  charsetParametro: 'CP1252',
  autenticacao: 'Srp256',
  canalCifrado: true,
  canalComprimido: false,
  protocolo: 'TCPv4',
  conta: 'SGH_APP',
  papel: 'SGH_APLICACAO',
};

function entrada(over: Partial<EntradaConferenciaInstalacao> = {}, conexao: Partial<ConexaoConferida> = {}) {
  return {
    ambiente: 'producao',
    conexao: { ...conexaoBoa, ...conexao },
    scripts: conferirScripts([{ numero: 1, hash: H('a') }], [{ numero: 1, hash: H('a') }]),
    charsetParametro: 'CP1252' as const,
    identificacao: '0.1.0+abc',
    ...over,
  } satisfies EntradaConferenciaInstalacao;
}

const sit = (e: EntradaConferenciaInstalacao, codigo: string) =>
  itensDaConferencia(e).find((i) => i.codigo === codigo)?.situacao;

describe('M60.2: conferência dos scripts do pacote contra o banco', () => {
  it('separa pendentes, divergentes (hash sem caixa) e desconhecidos, em ordem e com 4 dígitos', () => {
    const r = conferirScripts(
      [
        { numero: 1, hash: H('a') },
        { numero: 5, hash: H('b') },
        { numero: 600, hash: H('c') },
        { numero: 12, hash: H('d') },
      ],
      [
        { numero: 1, hash: H('A') },
        { numero: 5, hash: H('e') },
        { numero: 990, hash: H('f') },
      ],
    );
    expect(r).toEqual({
      registroLido: true,
      noPacote: 4,
      ultimoNoPacote: '0600',
      aplicados: 3,
      ultimoAplicado: '0990',
      pendentes: ['0012', '0600'],
      pendentesTotal: 2,
      divergentes: ['0005'],
      desconhecidos: ['0990'],
    });
  });

  it('lista no máximo o teto de pendentes, com o total à parte; banco vazio não tem último', () => {
    const pacote = Array.from({ length: 30 }, (_, i) => ({ numero: i + 1, hash: H('a') }));
    const r = conferirScripts(pacote, []);
    expect(r.pendentes).toHaveLength(TETO_PENDENTES_LISTADOS);
    expect(r.pendentesTotal).toBe(30);
    expect(r.ultimoAplicado).toBeNull();
    expect(conferirScripts([], []).ultimoNoPacote).toBeNull();
  });

  it('registro ilegível (conta sem o papel): registroLido falso, sem pendentes nem divergentes inventados', () => {
    const r = conferirScripts(
      [
        { numero: 1, hash: H('a') },
        { numero: 7, hash: H('b') },
      ],
      null,
    );
    expect(r).toEqual({
      registroLido: false,
      noPacote: 2,
      ultimoNoPacote: '0007',
      aplicados: 0,
      ultimoAplicado: null,
      pendentes: [],
      pendentesTotal: 0,
      divergentes: [],
      desconhecidos: [],
    });
  });
});

describe('M60.2: itens da conferência da instalação', () => {
  it('instalação correta em produção: todos os itens ok, na ordem do contrato', () => {
    const itens = itensDaConferencia(entrada({ identificacaoEsperada: '0.1.0+abc' }));
    expect(itens.map((i) => i.codigo)).toEqual([...ITENS_CONFERENCIA_INSTALACAO]);
    expect(itens.every((i) => i.situacao === 'ok')).toBe(true);
    expect(situacaoDaConferencia(itens)).toBe('ok');
  });

  it('em produção, SYSDBA, canal aberto, autenticação antiga e papel errado são falhas', () => {
    const e = entrada({}, { conta: 'sysdba', canalCifrado: false, autenticacao: 'Legacy_Auth', papel: null });
    for (const c of ['conta-propria', 'canal-cifrado', 'autenticacao', 'papel-aplicacao'])
      expect(sit(e, c), c).toBe('falha');
    expect(situacaoDaConferencia(itensDaConferencia(e))).toBe('falha');
  });

  it('fora de produção as mesmas condições são alertas (a exceção do SYSDBA no dev)', () => {
    const e = entrada(
      { ambiente: 'dev' },
      { conta: 'SYSDBA', canalCifrado: null, autenticacao: null, papel: '' },
    );
    for (const c of ['conta-propria', 'canal-cifrado', 'autenticacao', 'papel-aplicacao'])
      expect(sit(e, c), c).toBe('alerta');
    expect(situacaoDaConferencia(itensDaConferencia(e))).toBe('alerta');
  });

  it('charset desencontrado é falha em qualquer ambiente; UTF8 com UTF8 confere', () => {
    expect(sit(entrada({ ambiente: 'dev', charsetParametro: 'UTF8' }), 'charset')).toBe('falha');
    expect(sit(entrada({ charsetParametro: 'UTF8' }, { charsetBanco: 'UTF8' }), 'charset')).toBe('ok');
  });

  it('motor: 3 e 5 homologados, 4 é alerta, formato estranho é falha', () => {
    expect(sit(entrada({}, { versaoMotor: '5.0.1.1469' }), 'motor')).toBe('ok');
    expect(sit(entrada({}, { versaoMotor: '4.0.5' }), 'motor')).toBe('alerta');
    expect(sit(entrada({}, { versaoMotor: '' }), 'motor')).toBe('falha');
  });

  it('scripts: divergente e pendente são falhas; banco à frente do pacote é alerta', () => {
    const divergente = conferirScripts([{ numero: 1, hash: H('a') }], [{ numero: 1, hash: H('b') }]);
    const pendente = conferirScripts([{ numero: 1, hash: H('a') }], []);
    const frente = conferirScripts(
      [{ numero: 1, hash: H('a') }],
      [
        { numero: 1, hash: H('a') },
        { numero: 2, hash: H('b') },
      ],
    );
    expect(sit(entrada({ scripts: divergente }), 'scripts')).toBe('falha');
    expect(sit(entrada({ scripts: pendente }), 'scripts')).toBe('falha');
    expect(sit(entrada({ scripts: frente }), 'scripts')).toBe('alerta');
    const ilegivel = conferirScripts([{ numero: 1, hash: H('a') }], null);
    for (const ambiente of ['producao', 'dev']) {
      const i = itensDaConferencia(entrada({ ambiente, scripts: ilegivel })).find(
        (x) => x.codigo === 'scripts',
      );
      expect(i?.situacao).toBe('falha');
      expect(i?.detalhe).toMatch(/não lê o registro dos scripts.*conceda o papel SGH_APLICACAO/);
    }
  });

  it('versão: diferente da esperada é falha; sem esperada só mostra a instalada', () => {
    expect(sit(entrada({ identificacaoEsperada: '0.2.0+def' }), 'versao')).toBe('falha');
    expect(sit(entrada({ identificacaoEsperada: null }), 'versao')).toBe('ok');
  });

  it('nenhum detalhe cita senha, endereço ou o sistema anterior pelo nome', () => {
    const e = entrada({}, { conta: 'SYSDBA', canalCifrado: false, autenticacao: 'Legacy_Auth' });
    for (const i of itensDaConferencia(e))
      expect(i.detalhe).not.toMatch(/senha|spdata|legado\b|\d+\.\d+\.\d+\.\d+/i);
  });
});
