import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { conferirAmbiente, modeloAmbiente } from './ambiente.ts';
import { anexoVariaveis } from './anexo.ts';
import {
  arquivosGerados,
  CABECALHOS_SEGURANCA,
  firebirdCliente,
  LAYOUT,
  siteNginx,
  unitNode,
} from './artefatos.ts';
import {
  conferirArvore,
  foraDoPacote,
  hashDoConjunto,
  montarManifesto,
  nomeDoArtefato,
  pastaDaVersao,
} from './pacote.ts';
import { VARIAVEIS } from './variaveis.ts';

/** Um arquivo de servidor válido, sintético (nenhum segredo real). */
function preenchido(extra: Record<string, string> = {}): string {
  const env: Record<string, string> = {};
  for (const v of VARIAVEIS) if (v.uso !== 'opcional') env[v.chave] = v.valores?.[0] ?? 'x';
  Object.assign(env, {
    AMBIENTE: 'producao',
    ESTABELECIMENTOS: 'pc',
    PLATAFORMA_CHAVE_MESTRA: Buffer.alloc(32, 7).toString('base64'),
    SONDA_TOKEN: 'f'.repeat(64),
    WEB_ENDERECO: 'https://sgh.exemplo.invalid',
    DOCUMENTO_URL_VALIDACAO: 'https://sgh.exemplo.invalid/validar',
    FB_CLIENTE_BIBLIOTECA: '/usr/lib/x86_64-linux-gnu/libfbclient.so.2',
    TZ: 'UTC',
    LOG_NIVEL: 'info',
    FB_PC_NOME: 'Hospital de exemplo',
    FB_PC_HOST: 'banco.exemplo.invalid',
    FB_PC_PORTA: '3050',
    FB_PC_BANCO: 'sgh',
    FB_PC_USUARIO: 'SGH_APP',
    FB_PC_SENHA: '<x>',
    FB_PC_SCRIPTS_USUARIO: 'SGH_SCRIPTS',
    FB_PC_LEITURA_USUARIO: 'SGH_LEITURA',
    FB_PC_LEITURA_SENHA: '<x>',
    ...extra,
  });
  return Object.entries(env)
    .map(([k, v]) => `${k}="${v}"`)
    .join('\n');
}
const chaves = (t: string) => conferirAmbiente(t).map((p) => p.chave);

describe('M60.2: o modelo e a conferência do arquivo de ambiente do servidor', () => {
  it('o modelo tem toda variável obrigatória e só marcadores nos segredos', () => {
    const m = modeloAmbiente();
    const env = parseEnv(m) as Record<string, string>;
    for (const v of VARIAVEIS.filter((x) => x.uso === 'obrigatoria'))
      expect(env, v.chave).toHaveProperty(v.chave);
    for (const v of VARIAVEIS.filter((x) => x.segredo && x.chave in env))
      expect(['<gerar>', ''], v.chave).toContain(env[v.chave]);
    expect(env['FB_PC_SENHA']).toBe('<gerar>');
    expect(env['FB_PC_USUARIO']).toBe('SGH_APP');
    // O próprio modelo é recusado: ainda tem os marcadores.
    expect(conferirAmbiente(m).length).toBeGreaterThan(0);
  });

  it('um arquivo preenchido corretamente passa (a senha de scripts pode ficar fora)', () => {
    expect(conferirAmbiente(preenchido())).toEqual([]);
  });

  it('recusa ambiente de dev, chave de dev, SYSDBA, contas iguais, chave mestra curta e endereço http', () => {
    const t = preenchido({
      AMBIENTE: 'dev',
      SGH_DEV_PERMITIR_SYSDBA: 'sim',
      FB_PC_USUARIO: 'sysdba',
      FB_PC_LEITURA_USUARIO: 'SGH_SCRIPTS',
      PLATAFORMA_CHAVE_MESTRA: 'curta',
      WEB_ENDERECO: 'http://sgh.exemplo.invalid',
      SONDA_TOKEN: 'pouco',
      // Achado do ensaio: MARCA é o código do pacote de marca (a API não sobe com nome por extenso).
      MARCA: 'Rede Exemplo (teste)',
      // Achado do ensaio: o núcleo exige os processos em UTC.
      TZ: 'America/Sao_Paulo',
    });
    expect(chaves(t)).toEqual(
      expect.arrayContaining([
        'AMBIENTE',
        'SGH_DEV_PERMITIR_SYSDBA',
        'FB_PC_USUARIO',
        'PLATAFORMA_CHAVE_MESTRA',
        'WEB_ENDERECO',
        'SONDA_TOKEN',
        'MARCA',
        'TZ',
      ]),
    );
    expect(conferirAmbiente(t).filter((p) => p.chave === 'FB_PC_USUARIO')).toHaveLength(2);
  });

  it('recusa obrigatória ausente, marcador esquecido, porta inválida e valor fora da lista', () => {
    const t = preenchido({ SMTP_URL: '', S3_ACESSO: '<gerar>', FB_PC_PORTA: '99999', LOG_NIVEL: 'barulho' });
    expect(chaves(t)).toEqual(expect.arrayContaining(['SMTP_URL', 'S3_ACESSO', 'FB_PC_PORTA', 'LOG_NIVEL']));
  });

  it('API_PORTA só vazia ou a do layout: o nginx e a espera da saúde usam a porta do pacote', () => {
    expect(chaves(preenchido({ API_PORTA: '3400' }))).toContain('API_PORTA');
    expect(chaves(preenchido({ API_PORTA: '' }))).not.toContain('API_PORTA');
    expect(chaves(preenchido({ API_PORTA: '3300' }))).not.toContain('API_PORTA');
  });

  it('as mensagens citam só a chave, nunca o valor', () => {
    const t = preenchido({ PLATAFORMA_CHAVE_MESTRA: 'valor-secreto-curto', FB_PC_USUARIO: 'SYSDBA' });
    for (const p of conferirAmbiente(t)) expect(p.motivo).not.toMatch(/valor-secreto-curto/);
  });
});

describe('M60.2: arquivos do servidor gerados do layout', () => {
  it('units da api e do worker: usuário sem privilégio, arquivo de ambiente, cliente do banco e endurecimento', () => {
    for (const p of ['api', 'worker'] as const) {
      const u = unitNode(p);
      expect(u).toContain(`User=${LAYOUT.usuario}`);
      expect(u).toContain('Environment=SGH_ARQUIVO_AMBIENTE=/etc/sante-sgh/sante.env');
      expect(u).toContain('Environment=FIREBIRD=/etc/sante-sgh/firebird');
      expect(u).toContain(
        `ExecStart=/opt/sante-sgh/atual/node/bin/node --enable-source-maps /opt/sante-sgh/atual/apps/${p}/dist/main.js`,
      );
      for (const x of ['NoNewPrivileges=true', 'ProtectSystem=strict', 'CapabilityBoundingSet='])
        expect(u).toContain(x);
      expect(u).not.toMatch(/EnvironmentFile/);
    }
  });

  it('nginx: 80 só redireciona, 443 com TLS 1.2+, /api para a API local e os cabeçalhos em todo bloco', () => {
    const n = siteNginx();
    expect(n).toMatch(/listen 80;[\s\S]*return 301 https/);
    expect(n).toContain('ssl_protocols TLSv1.2 TLSv1.3;');
    expect(n).toContain(`proxy_pass http://127.0.0.1:${LAYOUT.portaApi};`);
    expect(n).toContain('root /opt/sante-sgh/atual/apps/web/dist;');
    for (const [k] of CABECALHOS_SEGURANCA) expect(n.split(`add_header ${k} `).length - 1, k).toBe(3);
    expect(n).toContain('server_tokens off;');
  });

  it('cliente do banco: Srp e canal cifrado obrigatório, nunca Legacy_Auth', () => {
    const f = firebirdCliente();
    expect(f).toMatch(/^AuthClient = Srp256, Srp$/m);
    expect(f).toMatch(/^WireCrypt = Required$/m);
    expect(f).not.toMatch(/^AuthClient.*Legacy/m);
  });

  it('todos os gerados têm o cabeçalho de não editar e nenhum segredo', () => {
    for (const [k, v] of Object.entries(arquivosGerados())) {
      expect(v, k).toMatch(/Gerado por pnpm instalacao:gerar/);
      expect(v, k).not.toMatch(/senha=|password|BEGIN .*PRIVATE KEY/i);
    }
  });

  it('o anexo lista toda variável do catálogo e as portas', () => {
    const a = anexoVariaveis();
    for (const v of VARIAVEIS) expect(a, v.chave).toContain(`\`${v.chave}\``);
    expect(a).toContain('| 443 |');
  });
});

describe('M60.2: o artefato de release e o manifesto', () => {
  const arq = [
    { caminho: 'b.txt', sha256: 'b'.repeat(64), bytes: 2 },
    { caminho: 'a.txt', sha256: 'a'.repeat(64), bytes: 1 },
  ];

  it('o hash do conjunto não depende da ordem e muda com qualquer arquivo', () => {
    expect(hashDoConjunto(arq)).toBe(hashDoConjunto([...arq].reverse()));
    expect(hashDoConjunto(arq)).not.toBe(hashDoConjunto([arq[0]!, { ...arq[1]!, sha256: 'c'.repeat(64) }]));
    const m = montarManifesto(
      {
        produto: 'P',
        versao: '0.1.0',
        commit: 'abcdef123456',
        identificacao: '0.1.0+abcdef123456',
        construidoEm: '2026-10-27T00:00:00.000Z',
        node: '24.22.0',
        scriptsSgh: { quantidade: 1, ultimo: '0001' },
      },
      arq,
    );
    expect(m).toMatchObject({ arquivos: 2, bytes: 3, sha256Conjunto: hashDoConjunto(arq) });
  });

  it('confere a árvore: falta, sobra e alterado', () => {
    const r = conferirArvore(arq, [arq[0]!, { caminho: 'c.txt', sha256: 'c'.repeat(64), bytes: 1 }]);
    expect(r).toEqual({ faltam: ['a.txt'], sobram: ['c.txt'], alterados: [] });
    expect(conferirArvore(arq, [{ ...arq[0]!, sha256: 'd'.repeat(64) }, arq[1]!]).alterados).toEqual([
      'b.txt',
    ]);
  });

  it('nunca leva segredo, .git, teste nem chave privada', () => {
    for (const c of [
      '.env.sante',
      'x/.env',
      '.git/config',
      'apps/api/src/a.spec.ts',
      'apps/web/e2e/x.ts',
      'tls/a.key',
    ])
      expect(foraDoPacote(c), c).toBe(true);
    for (const c of ['apps/api/dist/main.js', 'packages/legado/src/config/sgh/0001_versao_script.sql'])
      expect(foraDoPacote(c), c).toBe(false);
  });

  it('nome do artefato e pasta da versão', () => {
    const n = nomeDoArtefato('0.1.0', 'abcdef1234567890');
    expect(n).toBe('sante-sgh-0.1.0-abcdef123456.tar.gz');
    expect(pastaDaVersao(n)).toBe('sante-sgh-0.1.0-abcdef123456');
    expect(() => pastaDaVersao('../../etc/passwd.tar.gz')).toThrow();
  });
});
