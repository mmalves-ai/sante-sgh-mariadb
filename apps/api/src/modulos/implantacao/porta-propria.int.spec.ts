// Integração da porta própria da conferência da instalação e da fumaça (M60) contra o MariaDB real (cliente f22_o2,
// já criado pela obra da onda 2). Só leitura: nada é gravado nem apagado. Confere a conexão corrente (motor, charset,
// conta sem host), o relógio em UTC, a impressão estável da estrutura e o registro das migrações (nulo enquanto o
// modelo não tem a tabela). SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicoConferenciaInstalacao } from './aplicacao/conferencia.js';
import { contaSemHost, PortaImplantacaoPropria } from './porta-propria.js';

const CLIENTE = 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const c = { rede: 'rede-teste', hospital: 'L0208A' };

describe.skipIf(SEM_BANCO)('porta própria da implantação (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaImplantacaoPropria;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe('cliente_f22_o2');
    porta = new PortaImplantacaoPropria(nucleo, CLIENTE);
  });
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('a conexão corrente: MariaDB, utf8mb4 no banco, conta sem o host e nada de endereço', async () => {
    const x = await porta.conexao(c);
    expect(x.versaoMotor).toMatch(/^\d+\.\d+.*MariaDB/i);
    expect(x.charsetBanco).toBe('utf8mb4');
    expect(x.conta).not.toContain('@');
    expect(x.conta.length).toBeGreaterThan(0);
    expect(typeof x.canalCifrado).toBe('boolean');
    // Nenhum endereço nem host (o nome do método de autenticação pode conter "password": não é segredo).
    expect(JSON.stringify({ ...x, autenticacao: null })).not.toMatch(/127\.0\.0\.1|localhost|@|senha|password/i);
  });

  it('o relógio do banco em UTC, perto do relógio do servidor', async () => {
    const v = await porta.relogioBanco(c);
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(Math.abs(Date.parse(`${v}Z`) - Date.now())).toBeLessThan(60_000);
  });

  it('a impressão da estrutura é estável e cobre as tabelas do cliente', async () => {
    const a = await porta.estrutura(c);
    const b = await porta.estrutura(c);
    expect(a.resumo).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toEqual(b);
    expect(a.tabelas).toBeGreaterThan(100);
  });

  it('o registro das migrações: nulo sem a tabela no modelo; a conferência sai com o motivo, sem pendência inventada', async () => {
    const m = await porta.migracoesRegistradas(c);
    expect(m === null || Array.isArray(m)).toBe(true);
    const s = new ServicoConferenciaInstalacao({
      porta,
      ambiente: 'dev',
      scriptsDoPacote: () => [{ numero: 1, hash: 'a'.repeat(64) }],
      versao: () => ({ produto: 'p', versao: '0', commit: 'x', construidoEm: '', identificacao: '0+x' }),
      identificacaoEsperada: null,
    });
    const conf = await s.conferirContexto(c);
    expect(conf.conexao.charsetBanco).toBe('utf8mb4');
    expect(conf.itens.find((i) => i.codigo === 'motor')?.detalhe).toMatch(/^MariaDB /);
    if (m === null) expect(conf.scripts).toMatchObject({ registroLido: false, pendentesTotal: 0 });
  });

  it('conta sem host: "app@%" vira "app"', () => {
    expect(contaSemHost('sgh_app@%')).toBe('sgh_app');
    expect(contaSemHost('root')).toBe('root');
  });
});
