// Integração da receita do enfermeiro na porta própria (família sae-cadastro) contra o MariaDB real (cliente f22_o2).
// Massa SINTÉTICA (nenhuma pessoa real). Contrato de efeito: a receita assinada (número da sequência, protocolo, lista,
// segundo identificador, conteúdo e resumo SHA-256, itens com via e quantidade impressas), a repetição pela chave do
// pedido, a leitura (só do estabelecimento da sessão), a suspensão (a original fica legível e inativa, com o evento na
// fila de saída), a recusa da segunda inativação e da receita de outro atendimento, e a reemissão ligada à anterior.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { createHash } from 'node:crypto';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fusoDe } from './banco-apoio.js';
import {
  CLIENTE,
  contextoDe,
  garantirCliente,
  limparMassa,
  type MassaEnfermagem,
  montarMassa,
  P,
  SEM_BANCO,
} from './massa-enfermagem.spec-util.js';
import { PortaSaePropria } from './sae-porta-propria.js';
import { SEQUENCIA_RECEITA_ENFERMEIRO } from './sae-porta-propria-receita.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const recusada = async (p: Promise<unknown>) =>
  codigoDe(
    await p.then(
      () => null,
      (e: unknown) => e,
    ),
  );

describe.skipIf(SEM_BANCO)('porta própria da receita do enfermeiro (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSaePropria;
  let m: MassaEnfermagem | null = null;
  let agora = '';
  let receita = 0;
  const marca = `${Date.now()}`;
  const tipos: number[] = [];

  const ctxLeitura = { cliente: CLIENTE, correlacao: 't-receita' };
  const contar = (sql: string, p: unknown[]) =>
    nucleo.lerSomente(ctxLeitura, async (l) => Number((await l.uma<{ n: number }>(sql, p))?.n ?? 0));

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo, `${P}R`, false);
    porta = new PortaSaePropria(nucleo);
    const est = m.est;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-receita-massa' }, async (e) => {
      const instante = new Date();
      for (const [sufixo, antimicrobiano] of [
        ['S', false],
        ['R', true],
      ] as const) {
        await e.executar(
          `INSERT INTO tipo_receita (codigo, descricao, padrao, controle_especial, antimicrobiano, numero_vias,
                                     validade_dias, ativo, criado_em)
           VALUES (?, ?, TRUE, FALSE, ?, ?, ?, TRUE, ?)`,
          [`T${marca}${sufixo}`, 'Tipo sintético', antimicrobiano, antimicrobiano ? 2 : 1, 10, instante],
        );
        const t = await e.consultar<{ id: number }>('SELECT id FROM tipo_receita WHERE codigo = ?', [
          `T${marca}${sufixo}`,
        ]);
        tipos.push(Number(t[0]!.id));
      }
      await e.executar(
        `INSERT INTO sequencia_negocio (estabelecimento_id, tipo, prefixo, proximo_valor, incremento, ativo, criado_em)
         VALUES (?, ?, 'RE', 1, 1, TRUE, ?)`,
        [est, SEQUENCIA_RECEITA_ENFERMEIRO, instante],
      );
    });
    const fuso = await nucleo.lerSomente(ctxLeitura, (l) => fusoDe(l, est));
    agora = new Intl.DateTimeFormat('sv-SE', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .format(new Date())
      .replace(' ', 'T');
  }, 60_000);

  afterAll(async () => {
    if (m) {
      const ests = [m.est, m.outroEst];
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-receita-limpeza' }, async (e) => {
        await e.executar(
          `DELETE i FROM receita_medica_item i JOIN receita_medica r ON r.id = i.receita_medica_id
            WHERE r.estabelecimento_id IN (?, ?)`,
          ests,
        );
        await e.executar(
          'UPDATE receita_medica SET origem_receita_medica_id = NULL WHERE estabelecimento_id IN (?, ?)',
          ests,
        );
        await e.executar('DELETE FROM receita_medica WHERE estabelecimento_id IN (?, ?)', ests);
        await e.executar('DELETE FROM sequencia_negocio WHERE estabelecimento_id IN (?, ?) AND tipo = ?', [
          ...ests,
          SEQUENCIA_RECEITA_ENFERMEIRO,
        ]);
        if (tipos.length)
          await e.executar(`DELETE FROM tipo_receita WHERE id IN (${tipos.map(() => '?').join(',')})`, tipos);
      });
    }
    await limparMassa(nucleo, m);
    await nucleo.encerrar();
  });

  const c = () => contextoDe(m!);
  const impressao = 'Receita sintética do enfermeiro\nparacetamol 500 mg';
  const prescrever = (
    chave: string | null,
    anterior: number | null = null,
    modelo: 'simples' | 'retencao' = 'simples',
  ) =>
    porta.gravarSgh(c(), null, (g) =>
      g.prescreverMedicamento({
        paciente: m!.paciente,
        atendimento: m!.atendimento,
        protocolo: 'PROT-ENF.1',
        ano: 2026,
        tipoProtocolo: 'institucional',
        modelo,
        listaVersao: 'v3',
        segundoIdentificador: 'nascimento',
        coren: 'COREN-SP 000000',
        categoria: 'Enfermeiro',
        itens: [
          {
            medicamento: 'paracetamol',
            via: 'via oral (comprimido revestido)',
            posologia: '1 comprimido de 6 em 6 horas',
            quantidade: '2 caixas com 20 comprimidos revestidos cada',
          },
          { medicamento: 'dipirona', via: 'oral', posologia: '1 comprimido se dor', quantidade: '1 caixa' },
        ],
        impressao,
        assinadaEm: agora,
        vinculo: m!.profissional,
        usuario: m!.login,
        chave,
        anterior,
      }),
    );
  const inativar = (id: number, tipo: 'suspensao' | 'cancelamento', atendimento = m!.atendimento) =>
    porta.gravarSgh(c(), null, (g) =>
      g.inativarReceita({ id, atendimento, tipo, motivo: 'Motivo sintético', usuario: m!.login }),
    );

  it('assina a receita; repetição pela chave; lê com os itens e só no estabelecimento da sessão', async () => {
    const r = await prescrever(`rc-${marca}`);
    expect(r.repetida).toBe(false);
    receita = r.id;
    expect(await prescrever(`rc-${marca}`)).toEqual({ id: receita, repetida: true });
    const lidas = await porta.receitas(c(), m!.atendimento);
    expect(lidas).toHaveLength(1);
    expect(lidas[0]).toMatchObject({
      id: receita,
      protocolo: 'PROT-ENF.1',
      ano: 2026,
      tipoProtocolo: 'institucional',
      modelo: 'simples',
      listaVersao: 'v3',
      segundoIdentificador: 'nascimento',
      impressao,
      assinadaEm: agora,
      vinculo: m!.profissional,
      usuario: m!.login,
      anterior: null,
      reemitidaEm: null,
      inativacao: null,
    });
    expect(lidas[0]!.itens).toEqual([
      {
        medicamento: 'paracetamol',
        via: 'via oral (comprimido revestido)',
        posologia: '1 comprimido de 6 em 6 horas',
        quantidade: '2 caixas com 20 comprimidos revestidos cada',
      },
      { medicamento: 'dipirona', via: 'oral', posologia: '1 comprimido se dor', quantidade: '1 caixa' },
    ]);
    expect(await porta.receitas(contextoDe(m!, m!.outroEst), m!.atendimento)).toEqual([]);
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM receita_medica WHERE id = ? AND numero = 'RE1' AND numero_vias = 1
            AND situacao = 'emitida' AND hash_conteudo = ? AND validade_ate IS NOT NULL`,
        [receita, createHash('sha256').update(impressao, 'utf8').digest('hex')],
      ),
    ).toBe(1);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'receita_medica' AND entidade_id = ?",
        [receita],
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it('suspende (a original fica legível e inativa), recusa a segunda vez e a receita de outro atendimento', async () => {
    expect(await recusada(inativar(receita, 'suspensao', m!.atendimentoOutro))).toBe('receita-inexistente');
    const s = await inativar(receita, 'suspensao');
    expect(s.id).toBe(receita);
    expect(s.evento).toBeGreaterThan(0);
    expect(await recusada(inativar(receita, 'cancelamento'))).toBe('receita-ja-inativa');
    const [r] = await porta.receitas(c(), m!.atendimento);
    expect(r!.inativacao).toMatchObject({ tipo: 'suspensao', motivo: 'Motivo sintético', usuario: m!.login });
    expect(r!.impressao).toBe(impressao);
  });

  it('reemite ligada à anterior (modelo de retenção, duas vias); recusa a anterior de outro atendimento', async () => {
    const n = await prescrever(`rn-${marca}`, receita, 'retencao');
    const lidas = await porta.receitas(c(), m!.atendimento);
    expect(lidas.map((x) => x.id)).toEqual([n.id, receita]);
    expect(lidas[0]).toMatchObject({ modelo: 'retencao', anterior: receita, reemitidaEm: null });
    expect(lidas[1]).toMatchObject({ reemitidaEm: n.id });
    expect(await recusada(prescrever(null, 987_654_321))).toBe('receita-inexistente');
    expect(await recusada(inativar(987_654_321, 'cancelamento'))).toBe('receita-inexistente');
  });
});
