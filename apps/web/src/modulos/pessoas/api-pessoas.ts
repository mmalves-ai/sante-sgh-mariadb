// Cliente da gestão de pessoas, fatia F1 (M52.1): colaboradores, ficha, prévia pelo CPF (POST: o CPF nunca na URL),
// admissão, mudança funcional, dependente (inclusão e fim), desligamento (com a senha) e a validade do conselho. As gravações vão com o
// CSRF e a Idempotency-Key (uma por intenção); Problem Details viram ErroApi com o código da recusa em
// `problema.codigo`. As respostas seguem os tipos de @sgh/contratos (o servidor é a fonte; a tela confere a forma).
import type {
  AdmitirColaboradorEntrada,
  AlterarDependenteEntrada,
  AlterarVinculoEntrada,
  ApoioColaboradores,
  CorrigirColaboradorEntrada,
  DependenteEntrada,
  DesligarColaboradorEntrada,
  EncerrarDependenteEntrada,
  FichaColaborador,
  FiltroColaboradoresEntrada,
  FiltroHabilitacoesEntrada,
  LigarCargoColaboradorEntrada,
  ListaColaboradores,
  PainelConselho,
  PreviaAdmissao,
  RegistrarHabilitacaoEntrada,
  ResultadoDesligamento,
  ResultadoPessoas,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const P = '/api/pessoas';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export const lerApoioPessoas = (): Promise<ApoioColaboradores> =>
  ler(`${P}/apoio`, confiar<ApoioColaboradores>());

export const lerColaboradores = (f: Partial<FiltroColaboradoresEntrada>): Promise<ListaColaboradores> =>
  ler(
    `${P}/colaboradores${qs({
      termo: f.termo,
      centroCusto: f.centroCusto,
      unidade: f.unidade,
      setor: f.setor,
      tipo: f.tipo,
      estado: f.estado,
      depois: f.depois,
      limite: f.limite,
    })}`,
    confiar<ListaColaboradores>(),
  );

export const lerFicha = (vinculo: number): Promise<FichaColaborador> =>
  ler(`${P}/colaboradores/${vinculo}`, confiar<FichaColaborador>());

export const consultarCpf = (cpf: string): Promise<PreviaAdmissao> =>
  enviar(`${P}/admissao/previa`, { cpf }, confiar<PreviaAdmissao>(), novaChave('pessoas.previa'));

export const admitir = (e: AdmitirColaboradorEntrada): Promise<ResultadoPessoas> =>
  enviar(`${P}/colaboradores`, e, confiar<ResultadoPessoas>(), novaChave('pessoas.admitir'));

export const registrarMudanca = (
  vinculo: number,
  e: Omit<AlterarVinculoEntrada, 'vinculo'>,
): Promise<ResultadoPessoas> =>
  enviar(
    `${P}/colaboradores/${vinculo}/mudanca`,
    e,
    confiar<ResultadoPessoas>(),
    novaChave('pessoas.mudanca'),
  );

export const incluirDependente = (
  vinculo: number,
  e: Omit<DependenteEntrada, 'vinculo'>,
): Promise<ResultadoPessoas> =>
  enviar(
    `${P}/colaboradores/${vinculo}/dependentes`,
    e,
    confiar<ResultadoPessoas>(),
    novaChave('pessoas.dependente'),
  );

export const encerrarDependente = (
  vinculo: number,
  dependente: number,
  e: Omit<EncerrarDependenteEntrada, 'vinculo' | 'dependente'>,
): Promise<ResultadoPessoas> =>
  enviar(
    `${P}/colaboradores/${vinculo}/dependentes/${dependente}/encerramento`,
    e,
    confiar<ResultadoPessoas>(),
    novaChave('pessoas.dependente.fim'),
  );

// W0-06: correção cadastral (nome, matrícula, tipo, admissão) com motivo; o valor anterior fica em `correcoes`.
export const corrigirColaborador = (
  vinculo: number,
  e: Omit<CorrigirColaboradorEntrada, 'vinculo'>,
): Promise<ResultadoPessoas> =>
  enviar(
    `${P}/colaboradores/${vinculo}/correcao`,
    e,
    confiar<ResultadoPessoas>(),
    novaChave('pessoas.colaborador.correcao'),
  );

// W0-06 (5d-3a): o cargo do quadro de cargos e salários ligado ao colaborador (null retira), com motivo.
export const ligarCargoColaborador = (
  vinculo: number,
  e: Omit<LigarCargoColaboradorEntrada, 'vinculo'>,
): Promise<ResultadoPessoas> =>
  enviar(
    `${P}/colaboradores/${vinculo}/cargo`,
    e,
    confiar<ResultadoPessoas>(),
    novaChave('pessoas.colaborador.cargo'),
  );

// W0-06: alteração do dependente com versão (a anterior acaba na véspera de `desde`).
export const alterarDependente = (
  vinculo: number,
  dependente: number,
  e: Omit<AlterarDependenteEntrada, 'vinculo' | 'dependente'>,
): Promise<ResultadoPessoas> =>
  enviar(
    `${P}/colaboradores/${vinculo}/dependentes/${dependente}/alteracao`,
    e,
    confiar<ResultadoPessoas>(),
    novaChave('pessoas.dependente.alteracao'),
  );

export const desligar = (
  vinculo: number,
  e: Omit<DesligarColaboradorEntrada, 'vinculo'>,
  senha: string,
): Promise<ResultadoDesligamento> =>
  enviar(
    `${P}/colaboradores/${vinculo}/desligamento`,
    { ...e, senha },
    confiar<ResultadoDesligamento>(),
    novaChave('pessoas.desligar'),
  );

export const lerPainelConselho = (f: Partial<FiltroHabilitacoesEntrada>): Promise<PainelConselho> =>
  ler(
    `${P}/habilitacoes${qs({ situacao: f.situacao, conselho: f.conselho, depois: f.depois, limite: f.limite })}`,
    confiar<PainelConselho>(),
  );

export const registrarValidade = (e: RegistrarHabilitacaoEntrada): Promise<ResultadoPessoas> =>
  enviar(`${P}/habilitacoes`, e, confiar<ResultadoPessoas>(), novaChave('pessoas.habilitacao'));
