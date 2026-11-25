// A carteira do cadastro do paciente na abertura do atendimento (F3.1, cobertura do paciente). Regra de tela sem
// estado, testada à parte: qual carteira do cadastro preenche o convênio, o plano, a carteirinha e a validade da
// abertura. A escolha da proposta é do servidor (`proposta` de GET /api/cadastros/pacientes/:id/coberturas, regra do
// domínio do cadastro); aqui só se decide o que a tela preenche, e a pessoa confere antes de gravar.

/** O que a abertura usa de cada carteira do cadastro (resposta da rota das coberturas). */
export interface CarteiraDoCadastro {
  readonly id: number;
  readonly fontePagadora: { readonly id: number; readonly nome: string };
  readonly plano: { readonly id: number; readonly nome: string } | null;
  readonly numeroCarteira: string | null;
  readonly validade: string | null;
  readonly situacaoNoDia: string;
}

export interface CoberturasDoCadastro {
  readonly itens: readonly CarteiraDoCadastro[];
  readonly proposta: number | null;
}

/** Os campos da abertura que a carteira preenche (texto, como os campos da tela). */
export interface PreenchimentoCobertura {
  readonly carteira: number;
  readonly convenio: string;
  readonly matricula: string;
  readonly plano: string;
  readonly validadeCarteira: string;
}

const utilizavel = (c: CarteiraDoCadastro) => c.situacaoNoDia === 'vigente' || c.situacaoNoDia === 'a_vencer';

/**
 * A carteira do cadastro para a abertura.
 * - Sem convênio escolhido: a carteira proposta pelo servidor, se o estabelecimento aceita o convênio dela.
 * - Com convênio escolhido (pela pessoa, pelo agendamento ou pela herança): a carteira utilizável desse convênio, a
 *   proposta primeiro e depois a ordem do servidor (principal, vigência mais recente).
 * Vencida, encerrada e futura nunca preenchem. Sem carteira que sirva, `null`: a tela não mexe nos campos.
 */
export function preenchimentoDaCobertura(
  coberturas: CoberturasDoCadastro,
  convenio: string,
  aceitos: readonly number[],
): PreenchimentoCobertura | null {
  const uteis = coberturas.itens.filter((c) => utilizavel(c) && aceitos.includes(c.fontePagadora.id));
  const proposta = uteis.find((c) => c.id === coberturas.proposta) ?? null;
  const c =
    convenio === ''
      ? proposta
      : ((proposta && String(proposta.fontePagadora.id) === convenio ? proposta : null) ??
        uteis.find((x) => String(x.fontePagadora.id) === convenio) ??
        null);
  if (!c) return null;
  return {
    carteira: c.id,
    convenio: String(c.fontePagadora.id),
    matricula: c.numeroCarteira ?? '',
    plano: c.plano?.nome ?? '',
    validadeCarteira: c.validade ?? '',
  };
}
