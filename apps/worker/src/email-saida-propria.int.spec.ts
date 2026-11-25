// Contrato de efeito da saída do e-mail do sistema pelo cadastro do cliente (01-ADM L77, C1-063) sobre o MariaDB real:
// a finalidade do alerta vem da carga inicial (migração 02_ADM/99), o servidor da finalidade e do estabelecimento ganha
// do geral, o modelo do estabelecimento ganha do padrão e o fora de vigência não vale; o texto sai pelo modelo com os
// campos do alerta; fora de produção a conexão é a captura local; o registro de envio guarda finalidade, modelo e
// servidor usados. Massa sintética (códigos L77S), apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
import { conexaoDaSaida, textoPeloModelo, valoresDoAlerta } from '@sgh/dominio-acesso';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lerSaidaDoCadastro, saidaDoCliente } from './email-saida-propria.js';
import { mensagemDoAlerta } from './email.service.js';
import {
  CLIENTE,
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  SEM_BANCO,
} from './importadores/integracao.spec-util.js';
import { RegistroEnvioProprio } from './registro-envio-proprio.js';
import { limparTrilhaDaMassa } from './teste/limpar-trilha.spec-util.js';

const P = 'L77S';
const AGORA = new Date('2026-11-25T10:00:00.000');
const job = {
  rede: CLIENTE,
  hospital: 'l77s',
  idEmergencia: '4242',
  idUsuario: '900001',
  motivo: 'intercorrencia',
  inicio: '2026-11-25T09:00:00.000Z',
  fim: '2026-11-25T10:00:00.000Z',
};

describe.skipIf(SEM_BANCO)('saída do e-mail pelo cadastro do cliente', () => {
  let nucleo: NucleoProprio;
  let est = 0;
  let finalidade = 0;

  async function limpar(): Promise<void> {
    await escrever(nucleo, async (e) => {
      const envios = `SELECT id FROM envio_email WHERE assunto LIKE '%${P}%'`;
      await e.executar(`DELETE FROM envio_email_destinatario WHERE envio_email_id IN (${envios})`, []);
      await e.executar(`DELETE FROM envio_email WHERE assunto LIKE '%${P}%'`, []);
      await e.executar(`DELETE FROM modelo_email WHERE codigo LIKE '${P}%'`, []);
      await e.executar(`DELETE FROM servidor_email WHERE codigo LIKE '${P}%'`, []);
      await limparTrilhaDaMassa(e, { ids: [est] });
    });
  }

  const servidor = (codigo: string, extra: string, valores: unknown[]) =>
    escrever(nucleo, (e) =>
      e.executar(
        `INSERT INTO servidor_email (codigo, nome, host, porta, seguranca, exige_autenticacao, usuario_autenticacao,
            referencia_cofre, remetente_email, remetente_nome, padrao, ativo, criado_em${extra ? `, ${extra}` : ''})
         VALUES (?, 'SERVIDOR SINTETICO', ?, 587, 'starttls', TRUE, 'envio', 'email/saida/sintetico', ?, 'HOSPITAL L77S',
            FALSE, TRUE, NOW(3)${valores.map(() => ', ?').join('')})`,
        [
          codigo,
          `${codigo.toLowerCase()}.sintetico.invalid`,
          `${codigo.toLowerCase()}@sintetico.invalid`,
          ...valores,
        ],
      ),
    );
  const modelo = (
    codigo: string,
    estab: number | null,
    assunto: string,
    inicio: string | null,
    fim: string | null,
  ) =>
    escrever(nucleo, (e) =>
      e.executar(
        `INSERT INTO modelo_email (finalidade_email_id, estabelecimento_id, codigo, nome, assunto, corpo_html,
            corpo_texto, vigencia_inicio, vigencia_fim, ativo, criado_em)
         VALUES (?, ?, ?, 'MODELO SINTETICO', ?, '<p>Registro {{alerta.id_emergencia}}</p>', NULL, ?, ?, TRUE, NOW(3))`,
        [finalidade, estab, codigo, assunto, inicio, fim],
      ),
    );
  const ler = <T>(fn: Parameters<NucleoProprio['lerSomente']>[1]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l77s' }, fn) as Promise<T>;

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    est = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'l77s'));
    await limpar();
    const f = await ler<Record<string, unknown>[]>((l) =>
      l.consultar("SELECT id FROM finalidade_email WHERE codigo = 'ALERTA_EMERGENCIA'", []),
    );
    finalidade = Number(f[0]?.['id']);
    await servidor(`${P}GERAL`, '', []);
    await servidor(`${P}FIN`, 'finalidade_email_id', [finalidade]);
    await servidor(`${P}EST`, 'estabelecimento_id', [est]);
    await modelo(`${P}PADRAO`, null, `${P} PADRAO {{alerta.id_emergencia}}`, null, null);
    await modelo(
      `${P}EST`,
      est,
      `${P} EST {{alerta.id_emergencia}} ({{alerta.hospital}})`,
      '2026-01-01',
      null,
    );
    await modelo(`${P}VENCIDO`, est, `${P} VENCIDO`, '2026-12-01', null);
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('a carga inicial traz as finalidades dos alertas', async () => {
    const r = await ler<Record<string, unknown>[]>((l) =>
      l.consultar(
        `SELECT COUNT(*) AS n FROM finalidade_email WHERE ativo = TRUE AND codigo IN
          ('ALERTA_EMERGENCIA','ALERTA_SUPORTE','ALERTA_LEITURA','ALERTA_CHAMADO','RELATORIO_AGENDADO','LAUDO')`,
        [],
      ),
    );
    expect(Number(r[0]?.['n'])).toBe(6);
  });

  it('servidor da finalidade antes do geral; modelo do estabelecimento vigente antes do padrão', async () => {
    const s = await saidaDoCliente(nucleo, CLIENTE, 'alerta-emergencia', 'l77s', AGORA);
    expect(s.finalidade).toBe(finalidade);
    expect(s.estabelecimento).toBe(est);
    expect(s.servidor).toMatchObject({ host: `${P.toLowerCase()}fin.sintetico.invalid`, finalidade });
    expect(s.modelo?.assunto).toBe(`${P} EST {{alerta.id_emergencia}} ({{alerta.hospital}})`);
    const padrao = mensagemDoAlerta(job, 'destino@sintetico.invalid', 'x@sintetico.invalid');
    expect(textoPeloModelo(s.modelo!, valoresDoAlerta(job, padrao))).toMatchObject({
      assunto: `${P} EST 4242 (l77s)`,
      texto: 'Registro 4242',
    });
    // Fora de produção: a captura local, com o remetente do servidor cadastrado.
    expect(
      conexaoDaSaida(s.servidor, {
        producao: false,
        local: { host: '127.0.0.1', porta: 1025 },
        remetentePadrao: 'x@sintetico.invalid',
      }),
    ).toMatchObject({
      host: '127.0.0.1',
      usuario: null,
      remetente: `${P.toLowerCase()}fin@sintetico.invalid`,
    });
  });

  it('sem finalidade conhecida: servidor do estabelecimento antes do geral e nenhum modelo', async () => {
    const s = await ler<Awaited<ReturnType<typeof lerSaidaDoCadastro>>>((l) =>
      lerSaidaDoCadastro(l, 'outro-aviso', 'l77s', AGORA),
    );
    expect(s.finalidade).toBeNull();
    expect(s.modelo).toBeNull();
    expect(s.servidor).toMatchObject({ estabelecimento: est, finalidade: null });
  });

  it('o registro de envio guarda a finalidade, o modelo e o servidor usados', async () => {
    const s = await saidaDoCliente(nucleo, CLIENTE, 'alerta-emergencia', 'l77s', AGORA);
    const r = await new RegistroEnvioProprio(nucleo, CLIENTE, false, undefined, () => AGORA).registrar({
      estabelecimento: 'l77s',
      remetente: 'nao-responda@sintetico.invalid',
      destinatario: 'destino@sintetico.invalid',
      assunto: `${P} EST 4242 (l77s)`,
      corpo: 'Registro 4242',
      identificador: `<${P}.1.1@sintetico.invalid>`,
      aceito: true,
      origem: { finalidade: s.finalidade, modelo: s.modelo!.id, servidor: s.servidor!.id },
    });
    const [e] = await ler<Record<string, unknown>[]>((l) =>
      l.consultar(
        'SELECT finalidade_email_id, modelo_email_id, servidor_email_id, situacao FROM envio_email WHERE id = ?',
        [r.envio],
      ),
    );
    expect(e).toMatchObject({
      finalidade_email_id: finalidade,
      modelo_email_id: s.modelo!.id,
      servidor_email_id: s.servidor!.id,
      situacao: 'capturado',
    });
  });
});
