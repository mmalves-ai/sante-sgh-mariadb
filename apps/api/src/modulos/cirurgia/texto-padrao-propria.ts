// Texto padrão da descrição cirúrgica por procedimento e por cirurgião (F3.4, 04-CC linha 91), no banco do cliente
// (`texto_padrao_cirurgia`). Contrato de efeito:
//   - incluir: uma linha com título, procedimento (nulo = qualquer), cirurgião (nulo = texto do serviço), os três textos
//     e `tem_campos_preencher` apurado do próprio texto ({{campo}}); título repetido para o mesmo dono e procedimento é
//     recusado (409) antes do banco;
//   - alterar: a mesma linha com a versão lida (+1); a anterior fica na trilha;
//   - tirar de uso / voltar ao uso: `ativo` com a versão; nada é apagado;
//   - para a descrição: os textos ativos na ordem do domínio (do cirurgião para o procedimento primeiro), filtrados no
//     SQL, e o preenchimento dos campos de um texto ativo, sem gravar;
//   - dono: o texto pessoal (com cirurgião) só é incluído, alterado ou tirado de uso pelo próprio cirurgião (usuário
//     ligado ao profissional) ou por quem administra o bloco (permissão de gestão, passada pela rota); o texto do
//     serviço (sem cirurgião), por quem edita o registro cirúrgico.
//   - escopo: o texto é do cliente (vale em todos os estabelecimentos), como o cadastro de procedimento cirúrgico e o
//     de profissional a que se liga; decisão registrada na ficha F3.4 (04-CC linha 91).
import {
  camposDoTexto,
  preencherTexto,
  type TextoPadraoCirurgia,
  textosParaDescricao,
  validarTextoPadrao,
} from '@sgh/dominio-cirurgia';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';
import { semIndefinidos } from '../../entrada-exata.js';

export const PORTA_TEXTO_PADRAO_CIRURGIA = Symbol('PORTA_TEXTO_PADRAO_CIRURGIA');

/** Quem grava: a rota informa se o usuário administra o bloco (pode mexer no texto de qualquer cirurgião). */
export interface QuemGravaTexto {
  readonly gestor: boolean;
}

export interface TextoPadraoLido extends TextoPadraoCirurgia {
  readonly procedimentoDescricao: string | null;
  readonly cirurgiaoNome: string | null;
  readonly campos: string[];
  readonly versao: number;
}

const esquemaTexto = z
  .object({
    titulo: z.string().max(150),
    procedimento: z.number().int().positive().nullable(),
    cirurgiao: z.number().int().positive().nullable(),
    textoDescricao: z.string(),
    textoRisco: z.string().nullable().optional(),
    textoIntercorrencia: z.string().nullable().optional(),
  })
  .strict();

const SQL = `
  SELECT t.id, t.titulo, t.procedimento_cirurgico_id, t.profissional_id, t.texto_descricao, t.texto_risco_cirurgico,
         t.texto_intercorrencia, t.ativo, t.versao, pc.descricao AS procedimento_descricao, pf.nome AS cirurgiao_nome
    FROM texto_padrao_cirurgia t
    LEFT JOIN procedimento_cirurgico pc ON pc.id = t.procedimento_cirurgico_id
    LEFT JOIN profissional p ON p.id = t.profissional_id
    LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id`;

function lido(x: Record<string, unknown>): TextoPadraoLido {
  const textoDescricao = String(x['texto_descricao'] ?? '');
  const textoRisco = txtOuNull(x['texto_risco_cirurgico']);
  const textoIntercorrencia = txtOuNull(x['texto_intercorrencia']);
  return {
    id: num(x['id']),
    titulo: String(x['titulo']),
    procedimento: numOuNull(x['procedimento_cirurgico_id']),
    cirurgiao: numOuNull(x['profissional_id']),
    textoDescricao,
    textoRisco,
    textoIntercorrencia,
    ativo: bool(x['ativo']),
    versao: num(x['versao']),
    procedimentoDescricao: txtOuNull(x['procedimento_descricao']),
    cirurgiaoNome: txtOuNull(x['cirurgiao_nome']),
    campos: camposDoTexto(textoDescricao, textoRisco, textoIntercorrencia),
  };
}

export class PortaTextoPadraoCirurgiaPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, ['texto_padrao_cirurgia'], 'cirurgia.texto-padrao');
  }

  /** Todos (cadastro) ou, com procedimento ou cirurgião, os que a descrição oferece, na ordem do domínio. */
  listar(
    c: ContextoPortaPropria,
    filtro: { procedimento?: number | null; cirurgiao?: number | null; paraDescricao?: boolean },
  ): Promise<TextoPadraoLido[]> {
    return this.ler(c, 'listar', async (l) => {
      const onde: string[] = [];
      const args: unknown[] = [];
      if (filtro.paraDescricao) {
        onde.push(
          't.ativo = 1',
          '(t.procedimento_cirurgico_id IS NULL OR t.procedimento_cirurgico_id <=> ?)',
        );
        onde.push('(t.profissional_id IS NULL OR t.profissional_id <=> ?)');
        args.push(filtro.procedimento ?? null, filtro.cirurgiao ?? null);
      } else {
        if (filtro.procedimento) {
          onde.push('t.procedimento_cirurgico_id = ?');
          args.push(filtro.procedimento);
        }
        if (filtro.cirurgiao) {
          onde.push('t.profissional_id = ?');
          args.push(filtro.cirurgiao);
        }
      }
      const where = onde.length ? ` WHERE ${onde.join(' AND ')}` : '';
      const r = (await l.consultar(`${SQL}${where} ORDER BY t.titulo, t.id LIMIT 2000`, args)).map(lido);
      if (!filtro.paraDescricao) return r;
      return textosParaDescricao(r, {
        procedimento: filtro.procedimento ?? null,
        cirurgiao: filtro.cirurgiao ?? null,
      });
    });
  }

  /** Preenche os campos do texto com os valores, sem gravar (a descrição usa o resultado). */
  preencher(c: ContextoPortaPropria, id: number, entrada: unknown) {
    const x = entradaValida(
      z.object({ valores: z.record(z.string(), z.string().max(2000)) }).strict(),
      entrada,
    );
    return this.ler(c, 'preencher', async (l) => {
      const t = await l.uma(`${SQL} WHERE t.id = ?`, [id]);
      if (!t) throw naoEncontrado('Texto padrão');
      const v = lido(t);
      if (!v.ativo)
        throw recusaRegra('Texto fora de uso', [
          {
            campo: 'ativo',
            mensagem: 'Este texto padrão está fora de uso: escolha outro ou volte-o ao uso.',
          },
        ]);
      const d = preencherTexto(v.textoDescricao, x.valores);
      const r = v.textoRisco ? preencherTexto(v.textoRisco, x.valores) : null;
      const i = v.textoIntercorrencia ? preencherTexto(v.textoIntercorrencia, x.valores) : null;
      return {
        textoDescricao: d.texto,
        textoRisco: r?.texto ?? null,
        textoIntercorrencia: i?.texto ?? null,
        faltando: [...new Set([...d.faltando, ...(r?.faltando ?? []), ...(i?.faltando ?? [])])],
      };
    });
  }

  private async conferir(tx: Leitor, e: z.infer<typeof esquemaTexto>, id: number | null): Promise<void> {
    const p = validarTextoPadrao(semIndefinidos(e));
    if (p.length) throw recusaRegra('Texto padrão recusado', p);
    if (e.procedimento !== null) {
      const pc = await tx.uma('SELECT id FROM procedimento_cirurgico WHERE id = ?', [e.procedimento]);
      if (!pc) throw naoEncontrado('Procedimento cirúrgico');
    }
    if (e.cirurgiao !== null) {
      const pr = await tx.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [
        e.cirurgiao,
      ]);
      if (!pr) throw naoEncontrado('Profissional');
    }
    const dup = await tx.uma(
      `SELECT id FROM texto_padrao_cirurgia
        WHERE titulo = ? AND profissional_id <=> ? AND procedimento_cirurgico_id <=> ? AND id <> ?`,
      [e.titulo.trim(), e.cirurgiao, e.procedimento, id ?? 0],
    );
    if (dup)
      throw new ErroOperacao(
        409,
        'titulo-repetido',
        'Título repetido',
        'Já existe um texto com este título para o mesmo cirurgião e procedimento.',
      );
  }

  /** O texto pessoal de outro cirurgião só com a gestão do bloco. */
  private async conferirDono(
    tx: Leitor,
    usuario: number,
    quem: QuemGravaTexto,
    cirurgiao: number | null,
  ): Promise<void> {
    if (cirurgiao === null || quem.gestor) return;
    const meu = await tx.uma(
      'SELECT profissional_id FROM usuario_profissional WHERE usuario_vigente_id = ?',
      [usuario],
    );
    if (numOuNull(meu?.['profissional_id']) !== cirurgiao)
      throw new ErroOperacao(
        403,
        'texto-de-outro-cirurgiao',
        'Texto de outro cirurgião',
        'O texto pessoal só é mantido pelo próprio cirurgião ou por quem administra o bloco cirúrgico.',
      );
  }

  private colunas(e: z.infer<typeof esquemaTexto>) {
    return {
      titulo: e.titulo.trim(),
      procedimento_cirurgico_id: e.procedimento,
      profissional_id: e.cirurgiao,
      texto_descricao: e.textoDescricao,
      texto_risco_cirurgico: e.textoRisco?.trim() ? e.textoRisco : null,
      texto_intercorrencia: e.textoIntercorrencia?.trim() ? e.textoIntercorrencia : null,
      tem_campos_preencher: camposDoTexto(e.textoDescricao, e.textoRisco, e.textoIntercorrencia).length > 0,
    };
  }

  incluir(c: ContextoPortaPropria, entrada: unknown, quem: QuemGravaTexto): Promise<{ id: number }> {
    const e = entradaValida(esquemaTexto, entrada);
    return this.gravar(
      c,
      'cirurgia.texto-padrao.incluir',
      ['texto_padrao_cirurgia'],
      async (tx: TxOperacao, _est, usuario) => {
        await this.conferirDono(tx, usuario, quem, e.cirurgiao);
        await this.conferir(tx, e, null);
        const id = await tx.incluir('texto_padrao_cirurgia', { ...this.colunas(e), ativo: true });
        return { tabela: 'texto_padrao_cirurgia', id };
      },
    );
  }

  alterar(
    c: ContextoPortaPropria,
    id: number,
    entrada: unknown,
    quem: QuemGravaTexto,
  ): Promise<{ id: number }> {
    const { versao, ...resto } = entradaValida(
      esquemaTexto.extend({ versao: z.number().int().positive() }).strict(),
      entrada,
    );
    return this.gravar(
      c,
      'cirurgia.texto-padrao.alterar',
      ['texto_padrao_cirurgia'],
      async (tx: TxOperacao, _est, usuario) => {
        const a = await tx.uma('SELECT id, profissional_id FROM texto_padrao_cirurgia WHERE id = ?', [id]);
        if (!a) throw naoEncontrado('Texto padrão');
        await this.conferirDono(tx, usuario, quem, numOuNull(a['profissional_id']));
        await this.conferirDono(tx, usuario, quem, resto.cirurgiao);
        await this.conferir(tx, resto, id);
        await tx.alterar('texto_padrao_cirurgia', id, versao, this.colunas(resto));
        return { tabela: 'texto_padrao_cirurgia', id };
      },
    );
  }

  /** Tira de uso ou volta ao uso (nunca apaga: a descrição já assinada guarda o texto que usou). */
  definirUso(
    c: ContextoPortaPropria,
    id: number,
    entrada: unknown,
    quem: QuemGravaTexto,
  ): Promise<{ id: number }> {
    const x = entradaValida(
      z.object({ ativo: z.boolean(), versao: z.number().int().positive() }).strict(),
      entrada,
    );
    return this.gravar(
      c,
      'cirurgia.texto-padrao.uso',
      ['texto_padrao_cirurgia'],
      async (tx, _est, usuario) => {
        const a = await tx.uma('SELECT id, profissional_id FROM texto_padrao_cirurgia WHERE id = ?', [id]);
        if (!a) throw naoEncontrado('Texto padrão');
        await this.conferirDono(tx, usuario, quem, numOuNull(a['profissional_id']));
        await tx.alterar('texto_padrao_cirurgia', id, x.versao, { ativo: x.ativo });
        return { tabela: 'texto_padrao_cirurgia', id };
      },
    );
  }
}
