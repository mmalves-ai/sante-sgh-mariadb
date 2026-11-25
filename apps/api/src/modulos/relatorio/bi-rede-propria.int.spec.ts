// Contrato de efeito do BI consolidado da Rede (M57, etapa 3; C1-046) sobre o banco PRÓPRIO no MariaDB, pelo caminho
// que a API serve: um banco por cliente, e os estabelecimentos da rede moram no MESMO banco (rede/porta-propria.ts).
// Dois estabelecimentos SINTÉTICOS no banco do cliente de teste (f22_o1); o ServicoBiRede é o que o BiRedeController
// monta (a porta da Rede é a PortaRedePropria de `portasDaRede`: a lista e o contexto do banco vêm dela; a liberação é
// uma LiberacaoPep só, sobre a FonteConfiguracaoPropria; a internação pela FonteInternacaoPropria; os parâmetros pela
// ConfiguracaoM16). Confere:
//   - o consolidado: a soma dos numeradores sobre a soma dos denominadores, com a parcela de cada estabelecimento
//     (o movimento de cada um é lido pelo id dele no banco: a internação de um não aparece no outro);
//   - o desligado: com a chave `rede.bi` desligada no outro, ele fica fora do consolidado com o motivo;
//   - o pseudônimo: comum só com `rede.pseudonimoComum` ligada nos dois; senão, por estabelecimento.
// Os outros estabelecimentos do cliente de teste entram na lista da porta (é a regra da API); as conferências exatas
// são sobre os dois sintéticos, e o consolidado é conferido contra a soma de TODAS as parcelas incluídas.
// Massa sintética "C1046" (nenhuma pessoa real); tudo é apagado no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { CHAVE_LIBERACAO_BI_REDE, CHAVE_PSEUDONIMO_COMUM_REDE } from '@sgh/contratos';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import type { ModuleRef } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FonteConfiguracaoPropria } from '../config/configuracao-propria.js';
import { ConfiguracaoM16 } from '../internacao/configuracao.js';
import { FonteInternacaoPropria } from '../internacao/fonte-propria.js';
import { ServicoInternacao } from '../internacao/servico.js';
import { CONFIGURACAO_M16, SERVICO_INTERNACAO } from '../internacao/simbolos.js';
import { PORTA_REDE } from '../rede/porta.js';
import { PortaRedePropria } from '../rede/porta-propria.js';
import type { ServicoBiRede } from './aplicacao/bi-rede.js';
import { BiRedeController } from './bi-rede.controller.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const REDE = 'rede-c1046';
const P = 'C1046';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
/** Dois estabelecimentos no MESMO banco de cliente: A com um óbito, B com uma alta. */
const ESTS = [
  { codigo: 'bia1046', obito: true },
  { codigo: 'bib1046', obito: false },
] as const;
const [A, B] = ESTS;

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

interface Massa {
  est: number;
  catalogos: [string, number][];
  pessoas: number[];
  paciente: number;
  profissional: number;
}

/** Um estabelecimento com uma internação encerrada em janeiro de 2026 (óbito ou alta, conforme o banco). */
async function semear(e: Escritor, codigo: string, obito: boolean): Promise<Massa> {
  const agora = new Date();
  const m: Massa = { est: 0, catalogos: [], pessoas: [], paciente: 0, profissional: 0 };
  m.est = await garantir(
    e,
    'SELECT id FROM estabelecimento WHERE codigo = ?',
    [codigo],
    'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
    [codigo, `ESTAB SINTETICO ${codigo.toUpperCase()}`, `ESTAB SINTETICO ${codigo.toUpperCase()}`, agora],
  );
  await limparMovimento(e, m.est);
  const ua = await e.inserir(
    "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, ?, 'internacao', ?)",
    [m.est, `${P}-UA`, 'INTERNACAO SINTETICA', agora],
  );
  const ui = await e.inserir(
    "INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, criado_em) VALUES (?, ?, ?, ?, 'enfermaria', ?)",
    [m.est, ua, `${P}-UI`, 'ENFERMARIA SINTETICA', agora],
  );
  const bloco = await e.inserir(
    'INSERT INTO bloco_internacao (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)',
    [m.est, 'B1', 'BLOCO SINTETICO', agora],
  );
  const catalogo = async (tabela: string, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const id = await garantir(e, sel, p, ins, pi);
    m.catalogos.push([tabela, id]);
    return id;
  };
  const cat = await catalogo(
    'categoria_acomodacao',
    'SELECT id FROM categoria_acomodacao WHERE codigo = ?',
    [`${P}-ENF`],
    "INSERT INTO categoria_acomodacao (codigo, descricao, tipo, criado_em) VALUES (?, 'ENFERMARIA C1046', 'enfermaria', ?)",
    [`${P}-ENF`, agora],
  );
  const acomodacao = await e.inserir(
    `INSERT INTO acomodacao (estabelecimento_id, bloco_internacao_id, unidade_internacao_id, categoria_acomodacao_id,
       codigo, nome, quantidade_leitos, criado_em) VALUES (?, ?, ?, ?, 'ENF1', 'ENFERMARIA 1', 1, ?)`,
    [m.est, bloco, ui, cat, agora],
  );
  const sit = await garantir(
    e,
    "SELECT id FROM situacao_leito WHERE situacao_base = 'livre' ORDER BY id LIMIT 1",
    [],
    "INSERT INTO situacao_leito (codigo, descricao, situacao_base, criado_em) VALUES (?, 'LIVRE', 'livre', ?)",
    [`${P}-LIVRE`, agora],
  );
  await e.inserir(
    `INSERT INTO leito_hospitalar (estabelecimento_id, unidade_internacao_id, acomodacao_id, bloco_internacao_id,
       codigo, ramal, situacao_leito_id, ativo, criado_em) VALUES (?, ?, ?, ?, '01', '2101', ?, TRUE, ?)`,
    [m.est, ui, acomodacao, bloco, sit, agora],
  );
  const tiss = await catalogo(
    'carater_atendimento_tiss',
    'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
    ['C6'],
    "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('C6', 'CARATER C1046', 'teste', ?)",
    [agora],
  );
  const catAt = await catalogo(
    'categoria_atendimento',
    'SELECT id FROM categoria_atendimento WHERE codigo = ?',
    [`${P}-INT`],
    "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'INTERNACAO C1046', 'internacao', ?)",
    [`${P}-INT`, agora],
  );
  const carater = await catalogo(
    'carater_admissao',
    'SELECT id FROM carater_admissao WHERE codigo = ?',
    [`${P}-URG`],
    "INSERT INTO carater_admissao (codigo, descricao, urgencia, criado_em) VALUES (?, 'URGENCIA C1046', TRUE, ?)",
    [`${P}-URG`, agora],
  );
  const modal = await catalogo(
    'modalidade_internacao',
    'SELECT id FROM modalidade_internacao WHERE codigo = ?',
    [`${P}-CLI`],
    "INSERT INTO modalidade_internacao (codigo, descricao, criado_em) VALUES (?, 'CLINICA C1046', ?)",
    [`${P}-CLI`, agora],
  );
  const esp = await catalogo(
    'especialidade_medica',
    'SELECT id FROM especialidade_medica WHERE codigo = ?',
    [`${P}-CARD`],
    "INSERT INTO especialidade_medica (codigo, descricao, criado_em) VALUES (?, 'CARDIOLOGIA C1046', ?)",
    [`${P}-CARD`, agora],
  );
  const tipoSaida = obito ? 'obito' : 'alta';
  const motivo = await catalogo(
    'motivo_saida_hospitalar',
    'SELECT id FROM motivo_saida_hospitalar WHERE codigo = ?',
    [`${P}-${tipoSaida.toUpperCase()}`],
    `INSERT INTO motivo_saida_hospitalar (codigo, descricao, tipo_saida, exige_declaracao_obito, criado_em)
       VALUES (?, ?, ?, ?, ?)`,
    [`${P}-${tipoSaida.toUpperCase()}`, `SAIDA C1046 ${tipoSaida}`, tipoSaida, obito, agora],
  );
  const fonte = await catalogo(
    'fonte_pagadora',
    'SELECT id FROM fonte_pagadora WHERE codigo = ?',
    [`${P}-INT`],
    "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'OPERADORA C1046', 'operadora', 'ativa', ?)",
    [`${P}-INT`, agora],
  );
  const pessoa = (nome: string) =>
    garantir(
      e,
      'SELECT id FROM pessoa_fisica WHERE nome = ?',
      [nome],
      'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
      [nome, agora],
    );
  const pp = await pessoa(`PACIENTE SINTETICO ${P} ${codigo.toUpperCase()}`);
  const pm = await pessoa(`MEDICO SINTETICO ${P} ${codigo.toUpperCase()}`);
  m.pessoas = [pp, pm];
  m.paciente = await garantir(
    e,
    'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
    [pp],
    "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
    [pp, obito ? 910_461_001 : 910_461_002, agora],
  );
  m.profissional = await garantir(
    e,
    'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
    [pm],
    "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
    [pm, agora],
  );
  const entrada = new Date('2026-01-05T13:00:00Z');
  const alta = new Date('2026-01-08T13:00:00Z');
  const atendimento = await e.inserir(
    `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
       carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [m.est, `${P}-AT1`, m.paciente, catAt, tiss, fonte, m.profissional, entrada, agora],
  );
  await e.inserir(
    `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada,
       carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, acomodacao_id, especialidade_medica_id,
       medico_assistente_profissional_id, fonte_pagadora_id, situacao, data_hora_alta, motivo_saida_hospitalar_id,
       criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'alta', ?, ?, ?)`,
    [
      m.est,
      `${P}-IN1`,
      atendimento,
      m.paciente,
      entrada,
      carater,
      modal,
      ui,
      acomodacao,
      esp,
      m.profissional,
      fonte,
      alta,
      motivo,
      agora,
    ],
  );
  return m;
}

async function limparMovimento(e: Escritor, est: number): Promise<void> {
  await e.executar('DELETE FROM liberacao_chave WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM recurso_prerequisito WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM internacao WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM leito_hospitalar WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM acomodacao WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM bloco_internacao WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM unidade_internacao WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM unidade_assistencial WHERE estabelecimento_id = ?', [est]);
}

/** Liga (ou desliga) uma chave de recurso no estabelecimento inteiro, com os pré-requisitos de aprovação cumpridos. */
async function chave(e: Escritor, est: number, recurso: string, ligada: boolean): Promise<void> {
  const agora = new Date();
  await e.executar(
    `INSERT INTO liberacao_chave (estabelecimento_id, tipo, chave, escopo, valor, ligada, criado_em)
     VALUES (?, 'recurso', ?, 'hospital', '*', ?, ?)
     ON DUPLICATE KEY UPDATE ligada = VALUES(ligada), alterado_em = VALUES(criado_em), versao = versao + 1`,
    [est, recurso, ligada, agora],
  );
  await e.executar(
    `INSERT INTO recurso_prerequisito (estabelecimento_id, recurso, tipo, situacao, evidencia, criado_em)
     VALUES (?, ?, 'aprovacao', 'cumprido', 'ata sintetica C1046', ?)
     ON DUPLICATE KEY UPDATE situacao = 'cumprido'`,
    [est, recurso, agora],
  );
}

describe.skipIf(SEM_BANCO)(
  'BI consolidado da Rede no banco próprio (MariaDB, como o controller monta)',
  () => {
    let nucleo: NucleoProprio;
    let servico: ServicoBiRede;
    const massas = new Map<string, Massa>();

    const gravar = (fn: (e: Escritor) => Promise<void>) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-c1-046-bi-rede' }, fn);
    const nossos = new Set<string>(ESTS.map((e) => e.codigo));

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      for (const b of ESTS)
        await gravar(async (e) => {
          const m = await semear(e, b.codigo, b.obito);
          massas.set(b.codigo, m);
          await chave(e, m.est, CHAVE_LIBERACAO_BI_REDE, true);
          await chave(e, m.est, CHAVE_PSEUDONIMO_COMUM_REDE, true);
        });
      // A porta da Rede como `portasDaRede` (rede/modulo.ts) a monta: uma só, sobre o banco do cliente padrão.
      const porta = new PortaRedePropria(nucleo, CLIENTE, REDE);
      await porta.carregar();
      const configuracao = new FonteConfiguracaoPropria(nucleo, CLIENTE);
      const provedores = new Map<symbol, unknown>([
        [PORTA_REDE, porta],
        [SERVICO_INTERNACAO, new ServicoInternacao(new FonteInternacaoPropria(nucleo), null)],
        [CONFIGURACAO_M16, new ConfiguracaoM16(configuracao, null)],
      ]);
      const modulos = {
        get: (token: symbol) => {
          if (!provedores.has(token)) throw new Error('provedor ausente');
          return provedores.get(token);
        },
      } as unknown as ModuleRef;
      // O serviço é o que o controller monta (lista e contexto do banco da mesma porta; uma LiberacaoPep só).
      servico = new BiRedeController(modulos, configuracao, null).servico;
    });

    afterAll(async () => {
      if (!nucleo) return;
      for (const b of ESTS) {
        const m = massas.get(b.codigo);
        if (!m) continue;
        await gravar(async (e) => {
          await limparMovimento(e, m.est);
          await e.executar('DELETE FROM profissional WHERE id = ?', [m.profissional]);
          await e.executar('DELETE FROM paciente WHERE id = ?', [m.paciente]);
          for (const p of m.pessoas) await e.executar('DELETE FROM pessoa_fisica WHERE id = ?', [p]);
          for (const [t, id] of m.catalogos) {
            if (!/^[a-z_]+$/.test(t)) continue;
            await e.executar(`DELETE FROM ${t} WHERE id = ?`, [id]).catch(() => undefined);
          }
          await e.executar('DELETE FROM estabelecimento WHERE id = ?', [m.est]).catch(() => undefined);
        });
      }
      await nucleo.encerrar();
    });

    it('consolidado: Σ numeradores ÷ Σ denominadores, com a parcela de cada estabelecimento e o pseudônimo comum', async () => {
      const mort = await servico.serie(
        { rede: REDE, hospital: A.codigo },
        'taxaMortalidadeGeral',
        '2026-01',
        '2026-01',
      );
      // A lista vem da porta (todos os estabelecimentos do banco do cliente); o da sessão primeiro.
      expect(mort.estabelecimentos[0]!.codigo).toBe(A.codigo);
      expect(
        mort.estabelecimentos.filter((e) => nossos.has(e.codigo)).map((e) => [e.codigo, e.situacao]),
      ).toEqual([
        [A.codigo, 'incluido'],
        [B.codigo, 'incluido'],
      ]);
      const jan = mort.valores.find((v) => v.periodo === '2026-01')!;
      expect(
        jan.parcelas
          .filter((p) => nossos.has(p.estabelecimento))
          .map((p) => [p.estabelecimento, p.numerador, p.denominador, p.valor]),
      ).toEqual([
        [A.codigo, 1, 1, 100],
        [B.codigo, 0, 1, 0],
      ]);
      // Σ÷Σ sobre todas as parcelas incluídas (os outros estabelecimentos do cliente de teste, se liberados, somam).
      const soma = (k: 'numerador' | 'denominador') => jan.parcelas.reduce((t, p) => t + (p[k] ?? 0), 0);
      expect([jan.numerador, jan.denominador]).toEqual([soma('numerador'), soma('denominador')]);
      const outros = jan.parcelas.filter((p) => !nossos.has(p.estabelecimento));
      if (outros.length === 0) expect([jan.numerador, jan.denominador, jan.valor]).toEqual([1, 2, 50]);
      expect(jan.conta).toMatch(/× 100 = /);
      const adm = await servico.serie({ rede: REDE, hospital: A.codigo }, 'admissoes', '2026-01', '2026-01');
      const a = adm.valores.find((v) => v.periodo === '2026-01')!;
      expect(
        a.parcelas.filter((p) => nossos.has(p.estabelecimento)).map((p) => [p.estabelecimento, p.numerador]),
      ).toEqual([
        [A.codigo, 1],
        [B.codigo, 1],
      ]);
      expect(a.numerador).toBe(a.parcelas.reduce((t, p) => t + (p.numerador ?? 0), 0));
      const c = await servico.consolidado({ rede: REDE, hospital: B.codigo }, '2026-01', '2026-01');
      expect(c.estabelecimentos[0]!.codigo).toBe(B.codigo);
      expect(c.estabelecimentos.filter((e) => nossos.has(e.codigo)).map((e) => e.situacao)).toEqual([
        'incluido',
        'incluido',
      ]);
      // Pseudônimo comum só se TODOS os incluídos o ligaram: com outros incluídos sem a chave, é por estabelecimento.
      const outrosIncluidos = c.estabelecimentos.filter(
        (e) => !nossos.has(e.codigo) && e.situacao === 'incluido',
      );
      if (outrosIncluidos.length === 0) expect(c.pseudonimo).toBe('comum');
    });

    it('desligado: rede.bi desligada no outro deixa-o fora, com o motivo; o pseudônimo volta a ser por estabelecimento', async () => {
      const mb = massas.get(B.codigo)!;
      await gravar((e) => chave(e, mb.est, CHAVE_PSEUDONIMO_COMUM_REDE, false));
      try {
        // Pseudônimo comum desligado em um dos dois: os dois entram, e o pseudônimo é por estabelecimento.
        const p = await servico.consolidado({ rede: REDE, hospital: A.codigo }, '2026-01', '2026-01');
        expect(p.estabelecimentos.filter((e) => nossos.has(e.codigo)).map((e) => e.situacao)).toEqual([
          'incluido',
          'incluido',
        ]);
        expect(p.pseudonimo).toBe('por-estabelecimento');
        await gravar((e) => chave(e, mb.est, CHAVE_LIBERACAO_BI_REDE, false));
        const s = await servico.serie(
          { rede: REDE, hospital: A.codigo },
          'taxaMortalidadeGeral',
          '2026-01',
          '2026-01',
        );
        const sb = s.estabelecimentos.find((e) => e.codigo === B.codigo)!;
        expect([s.estabelecimentos[0]!.codigo, s.estabelecimentos[0]!.situacao, sb.situacao]).toEqual([
          A.codigo,
          'incluido',
          'desligado',
        ]);
        expect(sb.motivo).toMatch(/ainda não foi liberado/);
        const jan = s.valores.find((v) => v.periodo === '2026-01')!;
        expect(jan.parcelas.map((x) => x.estabelecimento)).not.toContain(B.codigo);
        expect(
          jan.parcelas.filter((x) => x.estabelecimento === A.codigo).map((x) => [x.numerador, x.denominador]),
        ).toEqual([[1, 1]]);
        if (jan.parcelas.length === 1) {
          expect([jan.numerador, jan.denominador, jan.valor]).toEqual([1, 1, 100]);
          expect(s.notas.join(' ')).toMatch(/um só estabelecimento/);
        }
        // O da sessão entra mesmo com a chave dele desligada (a sessão já passou pela chave dela no controller).
        const doB = await servico.consolidado({ rede: REDE, hospital: B.codigo }, '2026-01', '2026-01');
        expect(
          doB.estabelecimentos.filter((e) => nossos.has(e.codigo)).map((e) => [e.codigo, e.situacao]),
        ).toEqual([
          [B.codigo, 'incluido'],
          [A.codigo, 'incluido'],
        ]);
      } finally {
        await gravar((e) => chave(e, mb.est, CHAVE_LIBERACAO_BI_REDE, true));
        await gravar((e) => chave(e, mb.est, CHAVE_PSEUDONIMO_COMUM_REDE, true));
      }
    });

    it('fora da rede: a sessão de outra rede ou de estabelecimento fora do banco do cliente é recusada', async () => {
      await expect(
        servico.consolidado({ rede: 'outra-rede', hospital: A.codigo }, '2026-01', '2026-01'),
      ).rejects.toThrow(/Fora da rede/);
      await expect(
        servico.consolidado({ rede: REDE, hospital: 'zzz1046' }, '2026-01', '2026-01'),
      ).rejects.toThrow(/Fora da rede/);
      const porta = new PortaRedePropria(nucleo, CLIENTE, REDE);
      await expect(porta.contextoBanco({ rede: REDE, hospital: 'zzz1046' })).rejects.toThrow(/Fora da rede/);
      const ctx = await porta.contextoBanco({ rede: REDE, hospital: B.codigo });
      expect(ctx).toMatchObject({ cliente: CLIENTE, estabelecimento: massas.get(B.codigo)!.est });
    });
  },
);
