// O plano de gerenciamento das tecnologias em saúde (W0-08, parte 9b2; mercado M3; RDC 509/2021) gerado do cadastro:
// a montagem a partir das leituras (o descartado só no ciclo de vida; aptos e pendentes por modelo) e o HTML (contagens
// com a conta, índice com as parcelas, eventos, planos), autocontido e com o texto escapado. Dados sintéticos.
import type { ConclusaoDeCurso, CursoDoModelo, EventoCicloVida, IndiceObsolescencia } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { montarPgts } from './ciclo-vida.js';
import { htmlPgts } from './documentos.js';

const HOJE = '2026-10-28';
const indice = (idade: number, custo: number, falhas: number): IndiceObsolescencia => ({
  indice: idade + custo + falhas,
  faixa: idade + custo + falhas >= 70 ? 'substituir' : idade + custo + falhas >= 40 ? 'acompanhar' : 'manter',
  janelaMeses: 12,
  idade: { pontos: idade, peso: 40, razao: idade / 40, idadeMeses: 60, vidaUtilMeses: 120 },
  custo: { pontos: custo, peso: 30, razao: custo / 30, custoCent: 50_000, valorCent: 1_000_000 },
  falhas: { pontos: falhas, peso: 30, razao: falhas / 30, corretivas: 2, teto: 6 },
});
const eq = (id: number, codigo: string, x: Record<string, unknown> = {}) => ({
  id,
  codigo,
  nome: 'MONITOR <SINTETICO>',
  tipo: 'medico' as const,
  criticidade: 'critica' as const,
  classeRisco: 'III' as const,
  fabricante: 'Fabricante Sintético',
  modelo: 'MX-1',
  numeroSerie: `SN-${id}`,
  registroAnvisa: '80000000001',
  centroCusto: 104,
  situacao: 'ativo' as const,
  ...x,
});
const evento = (
  id: number,
  equipamento: number,
  tipo: EventoCicloVida['tipo'],
  data: string,
): EventoCicloVida => ({
  id,
  equipamento,
  tipo,
  data,
  motivo: `Motivo ${tipo}`,
  documento: tipo === 'descarte' ? 'CERT-DEST-1' : null,
  destino: tipo === 'descarte' ? 'residuo' : null,
  valorContabilCent: null,
  valorObtidoCent: null,
  autorizadoPor: 'Gerente sintético',
  por: 'SINT.MANUTENCAO',
  em: `${data}T10:00`,
});
const curso = (id: number, c: number, ativo = true): CursoDoModelo => ({
  id,
  fabricante: 'FABRICANTE SINTETICO',
  modelo: 'MX-1',
  curso: c,
  cursoCodigo: `C${c}`,
  cursoTitulo: `Operação segura ${c}`,
  cursoAtivo: ativo,
  validadeMeses: 24,
  criadoPor: 'SINT.MANUTENCAO',
  criadoEm: '2026-10-01T10:00',
});
const conclusao = (vinculo: number, c: number, validoAte: string | null): ConclusaoDeCurso => ({
  vinculo,
  nome: `Operador ${vinculo}`,
  matricula: null,
  curso: c,
  conclusao: '2026-01-10',
  validoAte,
});

const dados = () =>
  montarPgts({
    hoje: HOJE,
    equipamentos: [
      eq(3, 'EQ-0003', { tipo: 'infraestrutura', criticidade: 'alta', classeRisco: null, fabricante: null }),
      eq(1, 'EQ-0001'),
      eq(2, 'EQ-0002', { situacao: 'desativado' }),
    ],
    ciclo: new Map([
      [1, { indice: indice(20, 15, 10), eventos: [evento(11, 1, 'incorporacao', '2021-10-28')] }],
      [
        2,
        {
          indice: indice(40, 0, 0),
          eventos: [evento(23, 2, 'descarte', '2026-10-20'), evento(22, 2, 'desativacao', '2026-09-01')],
        },
      ],
      [3, { indice: indice(10, 0, 0), eventos: [] }],
    ]),
    setor: (cc) => (cc === 104 ? 'UTI SINTETICA' : String(cc)),
    cursos: [curso(1, 701), curso(2, 702), curso(3, 703, false)],
    conclusoes: [
      conclusao(801, 701, '2099-01-10'),
      conclusao(801, 702, null),
      conclusao(802, 701, '2099-01-10'),
      conclusao(803, 701, '2026-01-01'),
      conclusao(803, 702, null),
    ],
    planos: [
      {
        equipamento: 1,
        atividade: 'preventiva',
        periodicidade: { quantidade: 6, unidade: 'meses' },
        ativo: true,
        ultimaExecucao: '2026-08-01',
        ultimoResultado: 'aprovado',
      },
      {
        equipamento: 2,
        atividade: 'calibracao',
        periodicidade: { quantidade: 12, unidade: 'meses' },
        ativo: false,
        ultimaExecucao: null,
        ultimoResultado: null,
      },
    ],
    emissao: { estabelecimento: 'pc', emitidoEm: '2026-10-28T12:00:00Z', emitidoPor: 'SINT.MANUTENCAO' },
  });

describe('montagem do PGTS', () => {
  it('ordena pelo código, tira o descartado do parque, conta aptos e pendentes pelos cursos ativos do modelo', () => {
    const d = dados();
    expect(d.equipamentos.map((e) => [e.codigo, e.indice?.indice ?? null, e.setor])).toEqual([
      ['EQ-0001', 45, 'UTI SINTETICA'],
      ['EQ-0002', null, 'UTI SINTETICA'],
      ['EQ-0003', 10, 'UTI SINTETICA'],
    ]);
    // Um modelo; o descartado e o sem fabricante não contam; 701 e 702 ativos: 801 apto, 802 falta 702, 803 venceu 701.
    expect(d.modelos).toEqual([
      {
        fabricante: 'FABRICANTE SINTETICO',
        modelo: 'MX-1',
        equipamentos: 1,
        cursos: [
          { codigo: 'C701', titulo: 'Operação segura 701', validadeMeses: 24 },
          { codigo: 'C702', titulo: 'Operação segura 702', validadeMeses: 24 },
        ],
        aptos: 1,
        pendentes: 2,
      },
    ]);
    // Eventos na ordem da data (o descartado fica aqui); o plano do descartado sai.
    expect(d.eventos.map((e) => [e.data, e.tipo])).toEqual([
      ['2021-10-28', 'incorporacao'],
      ['2026-09-01', 'desativacao'],
      ['2026-10-20', 'descarte'],
    ]);
    expect(d.planos.map((p) => p.equipamento)).toEqual(['EQ-0001 MONITOR <SINTETICO>']);
  });
});

describe('documento do PGTS', () => {
  it('traz as contagens com a conta, o parque, o treinamento, o índice com as parcelas, o ciclo de vida e os planos', () => {
    const h = htmlPgts(dados());
    expect(h).toContain('<h1>Plano de gerenciamento das tecnologias em saúde</h1>');
    expect(h).toContain('pc · RDC 509/2021 · 2 equipamentos no parque, 1 descartados');
    // Contagens do parque (o descartado fora), com a conta.
    expect(h).toContain('<td>Equipamento médico-hospitalar</td><td class="v">1</td>');
    expect(h).toContain('<td>Infraestrutura (gases, energia, climatização, água)</td><td class="v">1</td>');
    expect(h).toContain('<td>Sem classe de risco</td><td class="v">1</td>');
    expect(h.match(/Conta: 1 \+ 1 = 2 equipamentos\./g)).toHaveLength(3);
    // Inventário com o texto escapado; o descartado não está.
    expect(h).toContain('<td>EQ-0001</td><td>MONITOR &lt;SINTETICO&gt;</td>');
    expect(h).toContain('<td>Fabricante Sintético · MX-1 · SN-1</td>');
    expect(h).not.toContain('<td>EQ-0002</td>');
    // Treinamento: modelo, equipamentos, cursos, aptos e pendentes.
    expect(h).toContain(
      '<td>FABRICANTE SINTETICO MX-1</td><td>1</td><td>C701 Operação segura 701 (validade 24 meses); C702 Operação segura 702 (validade 24 meses)</td><td>1</td><td>2</td>',
    );
    // Índice com as parcelas e a soma.
    expect(h).toContain('Índice de obsolescência (janela de 12 meses)');
    expect(h).toContain(
      '<td>EQ-0001 MONITOR &lt;SINTETICO&gt;</td><td>20 de 40 (60 de 120 meses)</td><td>15 de 30 (R$ 500,00 de R$ 10.000,00)</td><td>10 de 30 (2 corretivas, teto 6)</td><td>20 + 15 + 10 = 45</td><td>Acompanhar (planejar a substituição)</td>',
    );
    // Ciclo de vida e planos.
    expect(h).toContain(
      '<td>20/10/2026</td><td>EQ-0002 MONITOR &lt;SINTETICO&gt;</td><td>Descarte</td><td>Motivo descarte</td><td>CERT-DEST-1 · Resíduo (plano de gerenciamento de resíduos)</td><td>Gerente sintético</td>',
    );
    expect(h).toContain('<td>a cada 6 meses</td><td>Ativo</td><td>01/08/2026 (Aprovado)</td>');
    expect(h).toContain('Responsável técnico pelo gerenciamento');
    expect(h).toContain('Emitido em 28/10/2026 por SINT.MANUTENCAO');
    expect(h).not.toMatch(/https?:\/\/|<script|<link|<img/);
  });

  it('parque vazio: traços e conta zero', () => {
    const h = htmlPgts({
      equipamentos: [],
      modelos: [],
      eventos: [],
      planos: [],
      estabelecimento: 'pc',
      emitidoEm: '2026-10-28T12:00:00Z',
      emitidoPor: 'SINT.MANUTENCAO',
    });
    expect(h).toContain('0 equipamentos no parque</p>');
    expect(h).toContain('Conta: 0 = 0 equipamentos.');
    expect(h).toContain('Nenhum curso exigido.');
    expect(h).toContain('Nenhum evento registrado.');
  });
});
