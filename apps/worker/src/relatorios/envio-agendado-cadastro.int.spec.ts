// Contrato de efeito do relatório agendado e do aviso do sistema pelo cadastro do cliente (01-ADM L77, C1-063) sobre o
// MariaDB real: o relatório sai pelo servidor_email e pelo modelo_email vigente da finalidade RELATORIO_AGENDADO do
// estabelecimento (marcadores relatorio.<campo>), o aviso pela finalidade AVISO_SISTEMA (carga da migração 02_ADM/99),
// e cada mensagem fica no envio_email com finalidade_email_id, modelo_email_id e servidor_email_id. Fora de produção a
// conexão é a captura local, sem senha; em produção o servidor cadastrado, com a senha lida do cofre pela chave presa ao
// cliente (nunca gravada). Nenhuma conexão de rede: quem conecta é um registro em memória. Massa sintética (códigos
// L77R), apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AmbienteDoEnvio } from '../email-saida-cadastro.js';
import {
  CLIENTE,
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  SEM_BANCO,
} from '../importadores/integracao.spec-util.js';
import { entregadorPeloCadastro } from '../notificacao-despacho.service.js';
import { RegistroEnvioProprio } from '../registro-envio-proprio.js';
import type { ConexaoSmtp, MensagemEmail } from '../smtp.js';
import { limparTrilhaDaMassa } from '../teste/limpar-trilha.spec-util.js';
import { processarEnvio } from './envio-agendado.js';
import { dependenciasDoEnvio, redeDaFila, type SaidaDoRelatorio } from './envio-agendado.service.js';

const P = 'L77R';
const AGORA = new Date('2026-11-25T10:00:00.000');
const SENHA = 'Sintetica#L77R';
const job = (destino: string) => ({
  rede: redeDaFila(CLIENTE),
  hospital: 'l77r',
  agendamento: '77',
  titulo: `${P} Censo diário`,
  relatorio: 'Censo hospitalar',
  link: 'http://127.0.0.1:5300/relatorios?relatorio=censo',
  enderecos: [destino],
  grupos: [],
  dono: 'SINTETICO',
  registrar: false,
});

describe.skipIf(SEM_BANCO)('relatório agendado e aviso pelo cadastro do cliente', () => {
  let nucleo: NucleoProprio;
  let est = 0;
  const fin: Record<string, number> = {};
  const servidores: Record<string, number> = {};
  let modeloRelatorio = 0;
  const conexoes: { c: ConexaoSmtp; m: MensagemEmail }[] = [];

  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l77r' }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T>;

  async function limpar(): Promise<void> {
    await escrever(nucleo, async (e) => {
      const filtro = `assunto LIKE '%${P}%' OR remetente LIKE '%${P.toLowerCase()}%'`;
      await e.executar(
        `DELETE FROM envio_email_destinatario WHERE envio_email_id IN (SELECT id FROM envio_email WHERE ${filtro})`,
        [],
      );
      await e.executar(`DELETE FROM envio_email WHERE ${filtro}`, []);
      await e.executar(`DELETE FROM modelo_email WHERE codigo LIKE '${P}%'`, []);
      await e.executar(`DELETE FROM servidor_email WHERE codigo LIKE '${P}%'`, []);
      await limparTrilhaDaMassa(e, { ids: [est] });
    });
  }

  const ambiente = (producao: boolean): AmbienteDoEnvio => ({
    producao,
    local: { host: '127.0.0.1', porta: 1025 },
    remetentePadrao: 'nao-responda@sintetico.invalid',
    lerSegredo: async (chave) =>
      chave === `email/cliente/${CLIENTE}/email/saida/${P.toLowerCase()}` ? SENHA : null,
    conectar: async (c, m) => void conexoes.push({ c, m }),
  });
  const saida = (producao: boolean): SaidaDoRelatorio => ({
    nucleo,
    cliente: CLIENTE,
    registro: new RegistroEnvioProprio(nucleo, CLIENTE, producao, undefined, () => AGORA),
    ambiente: ambiente(producao),
  });
  const deps = (producao: boolean) =>
    dependenciasDoEnvio(
      null,
      { AMBIENTE: producao ? 'producao' : 'dev', PRODUTO_NOME: 'SGH' },
      () => AGORA,
      saida(producao),
    );
  const envioDo = async (destino: string) =>
    (
      await ler<Record<string, unknown>[]>(
        `SELECT e.finalidade_email_id, e.modelo_email_id, e.servidor_email_id, e.situacao, e.assunto, e.erro
           FROM envio_email e JOIN envio_email_destinatario d ON d.envio_email_id = e.id
          WHERE d.email = ? ORDER BY e.id DESC LIMIT 1`,
        [destino],
      )
    )[0];

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    est = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'l77r'));
    await limpar();
    const fs = await ler<Record<string, unknown>[]>(
      "SELECT id, codigo FROM finalidade_email WHERE codigo IN ('RELATORIO_AGENDADO','AVISO_SISTEMA')",
      [],
    );
    for (const f of fs) fin[String(f['codigo'])] = Number(f['id']);
    for (const [codigo, finalidade] of [
      [`${P}REL`, fin['RELATORIO_AGENDADO']],
      [`${P}AVI`, fin['AVISO_SISTEMA']],
    ] as const)
      servidores[codigo] = await escrever(nucleo, async (e) => {
        await e.executar(
          `INSERT INTO servidor_email (codigo, nome, host, porta, seguranca, exige_autenticacao, usuario_autenticacao,
              referencia_cofre, remetente_email, remetente_nome, padrao, ativo, criado_em, estabelecimento_id,
              finalidade_email_id)
           VALUES (?, 'SERVIDOR SINTETICO', ?, 587, 'starttls', TRUE, 'envio', ?, ?, 'HOSPITAL L77R', FALSE, TRUE,
              NOW(3), ?, ?)`,
          [
            codigo,
            `${codigo.toLowerCase()}.sintetico.invalid`,
            `email/saida/${P.toLowerCase()}`,
            `${codigo.toLowerCase()}@sintetico.invalid`,
            est,
            finalidade,
          ],
        );
        const r = await e.consultar('SELECT id FROM servidor_email WHERE codigo = ?', [codigo]);
        return Number(r[0]?.['id']);
      });
    modeloRelatorio = await escrever(nucleo, async (e) => {
      await e.executar(
        `INSERT INTO modelo_email (finalidade_email_id, estabelecimento_id, codigo, nome, assunto, corpo_html,
            corpo_texto, vigencia_inicio, vigencia_fim, ativo, criado_em)
         VALUES (?, ?, ?, 'MODELO SINTETICO', ?, '<p>Abra {{relatorio.link}}</p>', NULL, '2026-01-01', NULL, TRUE,
            NOW(3))`,
        [
          fin['RELATORIO_AGENDADO'],
          est,
          `${P}REL`,
          `${P} {{relatorio.titulo}} ({{relatorio.estabelecimento}})`,
        ],
      );
      const r = await e.consultar('SELECT id FROM modelo_email WHERE codigo = ?', [`${P}REL`]);
      return Number(r[0]?.['id']);
    });
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('a carga inicial traz as finalidades do relatório agendado e do aviso do sistema', () => {
    expect(fin['RELATORIO_AGENDADO']).toBeGreaterThan(0);
    expect(fin['AVISO_SISTEMA']).toBeGreaterThan(0);
  });

  it('fora de produção: captura local sem senha, texto pelo modelo, origem no envio_email', async () => {
    conexoes.length = 0;
    const destino = `dev.${P.toLowerCase()}@sintetico.invalid`;
    const r = await processarEnvio(job(destino), deps(false));
    expect(r).toMatchObject({ situacao: 'enviado', enviados: 1, falha: null });
    expect(conexoes).toHaveLength(1);
    expect(conexoes[0]!.c).toMatchObject({ host: '127.0.0.1', porta: 1025, usuario: null, senha: null });
    expect(conexoes[0]!.m).toMatchObject({
      de: `${P.toLowerCase()}rel@sintetico.invalid`,
      assunto: `${P} ${P} Censo diário (l77r)`,
      texto: 'Abra http://127.0.0.1:5300/relatorios?relatorio=censo',
    });
    expect(await envioDo(destino)).toMatchObject({
      finalidade_email_id: fin['RELATORIO_AGENDADO'],
      modelo_email_id: modeloRelatorio,
      servidor_email_id: servidores[`${P}REL`],
      situacao: 'capturado',
    });
  });

  it('em produção: o servidor cadastrado com a senha do cofre presa ao cliente; a senha nunca vai ao banco', async () => {
    conexoes.length = 0;
    const destino = `prod.${P.toLowerCase()}@sintetico.invalid`;
    const r = await processarEnvio(job(destino), deps(true));
    expect(r.situacao).toBe('enviado');
    expect(conexoes[0]!.c).toMatchObject({
      host: `${P.toLowerCase()}rel.sintetico.invalid`,
      porta: 587,
      seguranca: 'starttls',
      usuario: 'envio',
      senha: SENHA,
    });
    expect(await envioDo(destino)).toMatchObject({
      modelo_email_id: modeloRelatorio,
      servidor_email_id: servidores[`${P}REL`],
      situacao: 'enviado',
    });
    const vazou = await ler<Record<string, unknown>[]>(
      `SELECT COUNT(*) AS n FROM envio_email WHERE corpo LIKE ? OR assunto LIKE ?`,
      [`%${SENHA}%`, `%${SENHA}%`],
    );
    expect(Number(vazou[0]?.['n'])).toBe(0);
  });

  it('em produção sem a senha no cofre: falha fechada no envio_email, e o dono é alertado pelo servidor do ambiente', async () => {
    conexoes.length = 0;
    const destino = `semsenha.${P.toLowerCase()}@sintetico.invalid`;
    const dono = `dono.${P.toLowerCase()}@sintetico.invalid`;
    const s = saida(true);
    const d = dependenciasDoEnvio(null, { AMBIENTE: 'producao', ALERTA_RELATORIO_EMAIL: dono }, () => AGORA, {
      ...s,
      ambiente: { ...s.ambiente, lerSegredo: async () => null },
    });
    const r = await processarEnvio(job(destino), d);
    expect(r.situacao).toBe('falhou');
    expect(r.falha).toContain('cofre');
    // A tentativa recusada fica no registro, com a finalidade e o servidor do cadastro e o motivo; nada conectado.
    expect(await envioDo(destino)).toMatchObject({
      finalidade_email_id: fin['RELATORIO_AGENDADO'],
      servidor_email_id: servidores[`${P}REL`],
      modelo_email_id: null,
      situacao: 'falhou',
      erro: 'SaidaRecusadaSenhaForaDoCofre',
    });
    // O alerta ao dono não depende do cadastro que falhou: sai pelo servidor do ambiente, sem a finalidade.
    expect(r).toMatchObject({ alertouDono: true });
    expect(r.falhaAlerta).toBeUndefined();
    expect(conexoes).toHaveLength(1);
    expect(conexoes[0]!.c).toMatchObject({ host: '127.0.0.1', porta: 1025, usuario: null, senha: null });
    expect(conexoes[0]!.m.para).toBe(dono);
    expect(await envioDo(dono)).toMatchObject({
      finalidade_email_id: null,
      servidor_email_id: null,
      modelo_email_id: null,
      situacao: 'enviado',
    });
  });

  it('o alerta ao dono que também falha fica no resultado com o motivo', async () => {
    conexoes.length = 0;
    const s = saida(true);
    const d = dependenciasDoEnvio(
      null,
      { AMBIENTE: 'producao', ALERTA_RELATORIO_EMAIL: `dono2.${P.toLowerCase()}@sintetico.invalid` },
      () => AGORA,
      { ...s, ambiente: { ...s.ambiente, local: null, lerSegredo: async () => null } },
    );
    const r = await processarEnvio(job(`semsenha2.${P.toLowerCase()}@sintetico.invalid`), d);
    expect(r).toMatchObject({ situacao: 'falhou', alertouDono: false });
    expect(r.falhaAlerta).toContain('Nenhum servidor');
    expect(conexoes).toHaveLength(0);
  });

  it('aviso do sistema em produção sem a senha no cofre: a recusa fica no envio_email e volta à fila', async () => {
    conexoes.length = 0;
    const destino = `avisosemsenha.${P.toLowerCase()}@sintetico.invalid`;
    const entregar = entregadorPeloCadastro(nucleo, { ...ambiente(true), lerSegredo: async () => null });
    await expect(
      entregar(destino, `${P} Você tem 1 aviso no sistema`, 'Abra o sistema.', {
        estabelecimento: { cliente: CLIENTE, id: est, codigo: 'l77r', fuso: 'America/Sao_Paulo' },
        chave: `aviso.l77r.${P}.semsenha`,
        quantidade: 1,
      }),
    ).rejects.toThrow(/cofre/);
    expect(conexoes).toHaveLength(0);
    expect(await envioDo(destino)).toMatchObject({
      finalidade_email_id: fin['AVISO_SISTEMA'],
      servidor_email_id: servidores[`${P}AVI`],
      situacao: 'falhou',
      erro: 'SaidaRecusadaSenhaForaDoCofre',
    });
  });

  it('aviso do sistema pela finalidade AVISO_SISTEMA: servidor dela, texto padrão sem modelo', async () => {
    conexoes.length = 0;
    const destino = `aviso.${P.toLowerCase()}@sintetico.invalid`;
    const entregar = entregadorPeloCadastro(nucleo, ambiente(false));
    await entregar(destino, `${P} Você tem 2 avisos no sistema`, 'Abra o sistema.', {
      estabelecimento: { cliente: CLIENTE, id: est, codigo: 'l77r', fuso: 'America/Sao_Paulo' },
      chave: `aviso.l77r.${P}`,
      quantidade: 2,
    });
    expect(conexoes[0]!.m).toMatchObject({
      de: `${P.toLowerCase()}avi@sintetico.invalid`,
      assunto: `${P} Você tem 2 avisos no sistema`,
    });
    expect(await envioDo(destino)).toMatchObject({
      finalidade_email_id: fin['AVISO_SISTEMA'],
      modelo_email_id: null,
      servidor_email_id: servidores[`${P}AVI`],
      situacao: 'capturado',
    });
  });
});
