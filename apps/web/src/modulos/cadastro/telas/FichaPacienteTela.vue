<script setup lang="ts">
// Ficha do paciente (M11; ficha, seção 7): identificação, nome social, filiação com "mãe desconhecida",
// documentos (mascarados sem cadastro.paciente.verDocumento), endereço por CEP, contatos, responsável,
// estrangeiro, carteirinhas em consulta, dados sensíveis só com verSensivel (sem a permissão o servidor nem os
// manda) e os consentimentos. Cadastrar (rota /novo) procura pelo CPF antes de criar: candidatos com nome
// mascarado e nascimento, a escolha pelo prontuário. Alterar manda só o que mudou com a versão lida; a colisão
// vira o aviso do M07 (rever mantém o que foi digitado). O texto clínico antigo fica visível e nunca editável.
// Gravar segue a regra do executor (estado, chave de liberação, sessão só consulta): a tela pergunta antes e,
// sem liberação, nem abre o formulário de cadastro (o motivo aparece). O CEP completa logradouro e bairro ao
// sair do campo (CEP inexistente avisa antes de salvar). Datas pelo SanteData do M07 (data fora da faixa ou
// malformada vinda do sistema antigo aparece com o alerta, nunca "corrigida").
import {
  type CandidatosCpf,
  type EnderecoCep,
  type FichaPaciente,
  type Problema,
  tipoDoProblema,
} from '@sgh/contratos';
import {
  SanteAlerta,
  SanteAvisoColisao,
  SanteBotao,
  SanteCampoTexto,
  SanteData,
  SanteSelecao,
} from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import {
  alterarPaciente,
  cadastrarPaciente,
  candidatosPorCpf,
  lerEnderecoCep,
  lerFicha,
  lerGravacaoCadastro,
} from '../api-cadastro.js';
import ConsentimentosPaciente from '../componentes/ConsentimentosPaciente.vue';
import ContaPortalPaciente from '../../portal/componentes/ContaPortalPaciente.vue';
import { carimboBr, dataBr, diferencas, somenteDigitos } from '../formato.js';

const props = defineProps<{ id?: string }>();
const { t } = useI18n();
const roteador = useRouter();
const cliente = useQueryClient();

const novo = computed(() => props.id === undefined || props.id === 'novo');
const idNumero = computed(() => (novo.value ? 0 : Number(props.id)));

const ficha = useQuery({
  queryKey: computed(() => ['cadastro', 'ficha', idNumero.value]),
  queryFn: () => lerFicha(idNumero.value),
  enabled: computed(() => !novo.value && Number.isInteger(idNumero.value) && idNumero.value > 0),
  staleTime: 0,
});
const f = computed(() => ficha.data.value);
// Cadastrar grava agora para este login? (passo 0 do executor no servidor; o motivo vem de lá.)
const gravacaoNovo = useQuery({
  queryKey: ['cadastro', 'gravacao'],
  queryFn: () => lerGravacaoCadastro(),
  enabled: computed(() => novo.value && pode('cadastro.paciente.criar')),
  staleTime: 30_000,
});

// ── formulário: tudo como texto (o nascimento em AAAA-MM-DD, pelo SanteData); a conversão só no envio ──
interface Formulario {
  nome: string;
  nascimento: string;
  sexo: '' | 'F' | 'M';
  nomeMae: string;
  naturalidade: string;
  ufNaturalidade: string;
  cpf: string;
  identidade: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  telefone: string;
  celular: string;
  email: string;
  contatoNome: string;
  contatoTelefone: string;
}
const VAZIO: Formulario = {
  nome: '',
  nascimento: '',
  sexo: '',
  nomeMae: '',
  naturalidade: '',
  ufNaturalidade: '',
  cpf: '',
  identidade: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  telefone: '',
  celular: '',
  email: '',
  contatoNome: '',
  contatoTelefone: '',
};

function formularioDa(x: FichaPaciente): Formulario {
  return {
    nome: x.identificacao.nome,
    nascimento: x.identificacao.nascimento ?? '',
    sexo: x.identificacao.sexo ?? '',
    nomeMae: x.filiacao.mae ?? '',
    naturalidade: x.identificacao.naturalidade ?? '',
    ufNaturalidade: x.identificacao.ufNaturalidade ?? '',
    cpf: x.documentos.mascarados ? '' : somenteDigitos(x.documentos.cpf ?? ''),
    identidade: x.documentos.identidade ?? '',
    cep: x.endereco.cep ?? '',
    logradouro: x.endereco.logradouro ?? '',
    numero: x.endereco.numero === null ? '' : String(x.endereco.numero),
    complemento: x.endereco.complemento ?? '',
    bairro: x.endereco.bairro ?? '',
    telefone: x.contatos.telefone ?? '',
    celular: x.contatos.celular ?? '',
    email: x.contatos.email ?? '',
    contatoNome: x.responsavel.nome ?? '',
    contatoTelefone: x.responsavel.telefone ?? '',
  };
}

const editando = ref(false);
const lido = ref<Formulario>({ ...VAZIO });
const form = ref<Formulario>({ ...VAZIO });
const versao = ref('');
const mensagem = ref<string | null>(null);
const recusa = ref<string | null>(null);
const colisao = ref<Problema | null>(null);
const erro = ref<unknown>(null);
const salvando = ref(false);
const candidatos = ref<CandidatosCpf['candidatos'] | null>(null);
const cepEndereco = ref<Pick<EnderecoCep, 'cidade' | 'uf'> | null>(null);
const cepErro = ref<string | null>(null);

const nascimentoModelo = computed<string | null>({
  get: () => form.value.nascimento || null,
  set: (v) => {
    form.value.nascimento = v ?? '';
  },
});

/** Ao sair do campo CEP: completa logradouro e bairro (editáveis) e mostra cidade e UF; inexistente avisa. */
async function completarCep(): Promise<void> {
  const d = somenteDigitos(form.value.cep);
  if (d.length !== 8) {
    cepEndereco.value = null;
    cepErro.value = d.length === 0 ? null : t('cadastro.ficha.cepInexistente');
    return;
  }
  try {
    const r = await lerEnderecoCep(d);
    if (!r) {
      cepEndereco.value = null;
      cepErro.value = t('cadastro.ficha.cepInexistente');
      return;
    }
    cepErro.value = null;
    cepEndereco.value = { cidade: r.cidade, uf: r.uf };
    const trocou = d !== somenteDigitos(lido.value.cep);
    if (trocou || !form.value.logradouro.trim()) form.value.logradouro = r.logradouro ?? '';
    if (trocou || !form.value.bairro.trim()) form.value.bairro = r.bairro ?? '';
  } catch (e) {
    erro.value = e;
  }
}
const cidadeUf = computed(() => {
  const c =
    cepEndereco.value ?? (f.value ? { cidade: f.value.endereco.cidade, uf: f.value.endereco.uf } : null);
  return c ? [c.cidade, c.uf].filter(Boolean).join(' / ') : '';
});

watch(
  novo,
  (n) => {
    if (n) {
      form.value = { ...VAZIO };
      editando.value = true;
    }
  },
  { immediate: true },
);

function abrirEdicao(): void {
  if (!f.value) return;
  lido.value = formularioDa(f.value);
  form.value = { ...lido.value };
  versao.value = f.value.versao;
  cepEndereco.value = null;
  cepErro.value = null;
  limpar();
  editando.value = true;
}

function limpar(): void {
  recusa.value = null;
  colisao.value = null;
  erro.value = null;
  mensagem.value = null;
}

const opcoesSexo = computed(() => [
  { valor: '' as const, rotulo: '' },
  { valor: 'F' as const, rotulo: t('cadastro.ficha.sexos.F') },
  { valor: 'M' as const, rotulo: t('cadastro.ficha.sexos.M') },
]);

const opcional = (v: string) => (v.trim() === '' ? undefined : v.trim());
const apagavel = (v: string) => (v.trim() === '' ? null : v.trim());

function entradaDoCadastro(): Record<string, unknown> | null {
  const x = form.value;
  const nascimento = x.nascimento || null;
  if (!x.nome.trim() || !nascimento || !x.sexo || !x.cpf.trim() || !x.naturalidade.trim() || !x.cep.trim()) {
    recusa.value = t('cadastro.ficha.obrigatorios');
    return null;
  }
  if (x.ufNaturalidade && !/^[A-Za-z]{2}$/.test(x.ufNaturalidade)) {
    recusa.value = t('cadastro.ficha.ufInvalida');
    return null;
  }
  const e: Record<string, unknown> = {
    nome: x.nome,
    nascimento,
    sexo: x.sexo,
    cpf: somenteDigitos(x.cpf),
    naturalidade: x.naturalidade,
    cep: somenteDigitos(x.cep),
  };
  const opcionais: [string, string | undefined][] = [
    ['nomeMae', opcional(x.nomeMae)],
    ['ufNaturalidade', opcional(x.ufNaturalidade)],
    ['logradouro', opcional(x.logradouro)],
    ['complemento', opcional(x.complemento)],
    ['bairro', opcional(x.bairro)],
    ['celular', opcional(somenteDigitos(x.celular))],
    ['telefone', opcional(somenteDigitos(x.telefone))],
    ['email', opcional(x.email)],
    ['contatoNome', opcional(x.contatoNome)],
    ['contatoTelefone', opcional(somenteDigitos(x.contatoTelefone))],
  ];
  for (const [k, v] of opcionais) if (v !== undefined) e[k] = v;
  if (x.numero.trim()) e['numero'] = Number(x.numero);
  return e;
}

function alteracoesDoForm(): Record<string, unknown> | null {
  const d = diferencas(lido.value, form.value);
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d) as [keyof Formulario, string][]) {
    switch (k) {
      case 'nascimento': {
        if (!v) {
          recusa.value = t('cadastro.ficha.obrigatorios');
          return null;
        }
        r[k] = v;
        break;
      }
      case 'numero':
        r[k] = v.trim() === '' ? null : Number(v);
        break;
      case 'cpf':
      case 'cep':
        r[k] = somenteDigitos(v);
        break;
      case 'telefone':
      case 'celular':
      case 'contatoTelefone':
        r[k] = v.trim() === '' ? null : somenteDigitos(v);
        break;
      case 'ufNaturalidade':
      case 'nomeMae':
      case 'identidade':
      case 'complemento':
      case 'email':
      case 'contatoNome':
        r[k] = apagavel(v);
        break;
      default:
        r[k] = v;
    }
  }
  return r;
}

function tratarErro(e: unknown): void {
  const tipo = e instanceof ErroApi && e.problema ? tipoDoProblema(e.problema) : null;
  if (tipo === 'conflito-de-versao' && e instanceof ErroApi && e.problema) colisao.value = e.problema;
  else if (
    (tipo === 'recusa-de-negocio' || tipo === 'entrada-invalida') &&
    e instanceof ErroApi &&
    e.problema
  )
    recusa.value = e.problema.detail ?? e.problema.title ?? '';
  else erro.value = e;
}

async function procurarCpf(): Promise<void> {
  candidatos.value = null;
  const cpf = somenteDigitos(form.value.cpf);
  if (cpf.length !== 11) return;
  try {
    candidatos.value = (await candidatosPorCpf(cpf)).candidatos;
  } catch (e) {
    tratarErro(e);
  }
}

async function salvar(): Promise<void> {
  limpar();
  if (cepErro.value) {
    recusa.value = cepErro.value;
    return;
  }
  salvando.value = true;
  try {
    if (novo.value) {
      const e = entradaDoCadastro();
      if (!e) return;
      // Procurar antes de criar (ref 01 §3.14): CPF já cadastrado mostra os candidatos e não grava.
      await procurarCpf();
      if (candidatos.value && candidatos.value.length > 0) return;
      const r = await cadastrarPaciente(e);
      await roteador.replace(`/cadastros/pacientes/${r.idPaciente}`);
      mensagem.value = t('cadastro.ficha.criado', { prontuario: r.prontuario });
      editando.value = false;
    } else {
      const a = alteracoesDoForm();
      if (!a) return;
      if (Object.keys(a).length === 0) {
        editando.value = false;
        return;
      }
      await alterarPaciente(idNumero.value, versao.value, a);
      await cliente.invalidateQueries({ queryKey: ['cadastro', 'ficha', idNumero.value] });
      mensagem.value = t('cadastro.ficha.salvo');
      editando.value = false;
    }
  } catch (e) {
    tratarErro(e);
  } finally {
    salvando.value = false;
  }
}

async function rever(): Promise<void> {
  // Colisão: relê a ficha (o que está no banco agora) e mantém por cima só o que a pessoa mudou.
  const digitado = diferencas(lido.value, form.value);
  const r = await ficha.refetch();
  if (!r.data) return;
  lido.value = formularioDa(r.data);
  form.value = { ...lido.value, ...digitado };
  versao.value = r.data.versao;
  colisao.value = null;
}

function cancelar(): void {
  if (novo.value) void roteador.push('/cadastros/pacientes');
  else {
    editando.value = false;
    limpar();
  }
}

const podeGravar = computed(() =>
  novo.value
    ? pode('cadastro.paciente.criar') && gravacaoNovo.data.value?.cadastrar.pode === true
    : (f.value?.permissoes.editar ?? false) && (f.value?.gravacao.alterar ?? false),
);
const motivoSemGravacao = computed(() =>
  novo.value
    ? gravacaoNovo.data.value && !gravacaoNovo.data.value.cadastrar.pode
      ? gravacaoNovo.data.value.cadastrar.motivo
      : !pode('cadastro.paciente.criar')
        ? t('cadastro.ficha.semPerfilCadastro')
        : null
    : (f.value?.gravacao.motivo ?? null),
);
const cpfEditavel = computed(() => novo.value || (f.value ? !f.value.documentos.mascarados : false));
const nomePrincipal = computed(() =>
  f.value ? (f.value.identificacao.nomeSocial ?? f.value.identificacao.nome) : t('cadastro.ficha.novo'),
);
const sim = (b: boolean) => (b ? t('cadastro.sim') : t('cadastro.nao'));
</script>

<template>
  <section class="tela" aria-labelledby="ficha-titulo" data-testid="tela-ficha-paciente">
    <MensagemErro v-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!novo && !f">{{ t('cadastro.carregando') }}</p>
    <template v-else>
      <header class="cabecalho">
        <h1 id="ficha-titulo">{{ nomePrincipal }}</h1>
        <p v-if="f">
          <strong data-testid="ficha-prontuario">{{
            t('cadastro.ficha.prontuario', { numero: f.prontuario })
          }}</strong>
          <span v-if="f.prontuarioAnterior">
            · {{ t('cadastro.ficha.prontuarioAnterior', { numero: f.prontuarioAnterior }) }}</span
          >
          · {{ t(`cadastro.situacoes.${f.situacao}`) }}
        </p>
        <nav class="acoes">
          <RouterLink to="/cadastros/pacientes">{{ t('cadastro.voltar') }}</RouterLink>
          <RouterLink v-if="f && f.permissoes.lerHistorico" :to="`/cadastros/pacientes/${f.id}/historico`">{{
            t('cadastro.ficha.historico')
          }}</RouterLink>
        </nav>
      </header>

      <SanteAlerta
        v-if="f && f.unificadoEm !== null && f.unificadoEm !== f.id"
        :texto="t('cadastro.ficha.unificado', { id: f.unificadoEm })"
        variante="aviso"
      />
      <SanteAlerta
        v-if="f?.obito"
        :texto="t('cadastro.ficha.obito', { data: dataBr(f.obito.data) })"
        variante="info"
      />
      <SanteAlerta
        v-if="motivoSemGravacao"
        :texto="t('cadastro.ficha.semGravacao', { motivo: motivoSemGravacao })"
        variante="info"
        data-testid="sem-gravacao"
      />
      <p v-if="mensagem" role="status" data-testid="mensagem-ficha">{{ mensagem }}</p>

      <!-- ── visualização ── -->
      <div v-if="f && !editando" class="ficha" data-testid="ficha-visualizacao">
        <SanteBotao
          v-if="podeGravar"
          :rotulo="t('cadastro.ficha.editar')"
          variante="primario"
          data-testid="botao-editar"
          @acionar="abrirEdicao"
        />
        <section aria-labelledby="sec-identificacao">
          <h2 id="sec-identificacao">{{ t('cadastro.ficha.identificacao') }}</h2>
          <dl>
            <dt>{{ t('cadastro.ficha.nome') }}</dt>
            <dd data-testid="ficha-nome">{{ f.identificacao.nome }}</dd>
            <template v-if="f.identificacao.nomeSocial">
              <dt>{{ t('cadastro.ficha.nomeSocial') }}</dt>
              <dd>{{ f.identificacao.nomeSocial }}</dd>
            </template>
            <dt>{{ t('cadastro.ficha.nascimento') }}</dt>
            <dd><SanteData :model-value="f.identificacao.nascimento" data-testid="ficha-nascimento" /></dd>
            <dt>{{ t('cadastro.ficha.sexo') }}</dt>
            <dd>{{ f.identificacao.sexo ? t(`cadastro.ficha.sexos.${f.identificacao.sexo}`) : '' }}</dd>
            <dt>{{ t('cadastro.ficha.estadoCivil') }}</dt>
            <dd>{{ f.identificacao.estadoCivil?.rotulo ?? '' }}</dd>
            <dt>{{ t('cadastro.ficha.naturalidade') }}</dt>
            <dd>
              {{ [f.identificacao.naturalidade, f.identificacao.ufNaturalidade].filter(Boolean).join(' / ') }}
            </dd>
            <dt>{{ t('cadastro.ficha.nacionalidade') }}</dt>
            <dd>{{ f.identificacao.nacionalidade ?? '' }}</dd>
            <dt>{{ t('cadastro.ficha.estrangeiro') }}</dt>
            <dd>{{ sim(f.identificacao.estrangeiro) }}</dd>
          </dl>
        </section>
        <section aria-labelledby="sec-filiacao">
          <h2 id="sec-filiacao">{{ t('cadastro.ficha.filiacao') }}</h2>
          <dl>
            <dt>{{ t('cadastro.ficha.mae') }}</dt>
            <dd>
              {{ f.filiacao.maeDesconhecida ? t('cadastro.ficha.maeDesconhecida') : (f.filiacao.mae ?? '') }}
            </dd>
            <dt>{{ t('cadastro.ficha.pai') }}</dt>
            <dd>{{ f.filiacao.pai ?? '' }}</dd>
          </dl>
        </section>
        <section aria-labelledby="sec-documentos">
          <h2 id="sec-documentos">{{ t('cadastro.ficha.documentos') }}</h2>
          <p v-if="f.documentos.mascarados" data-testid="documentos-mascarados">
            {{ t('cadastro.ficha.mascarados') }}
          </p>
          <dl>
            <dt>{{ t('cadastro.ficha.cpf') }}</dt>
            <dd data-testid="ficha-cpf">{{ f.documentos.cpf ?? '' }}</dd>
            <dt>{{ t('cadastro.ficha.cns') }}</dt>
            <dd>{{ f.documentos.cns ?? '' }}</dd>
            <dt>{{ t('cadastro.ficha.identidade') }}</dt>
            <dd>{{ f.documentos.mascarados ? t('cadastro.restrito') : (f.documentos.identidade ?? '') }}</dd>
          </dl>
        </section>
        <section aria-labelledby="sec-endereco">
          <h2 id="sec-endereco">{{ t('cadastro.ficha.endereco') }}</h2>
          <dl>
            <dt>{{ t('cadastro.ficha.cep') }}</dt>
            <dd>{{ f.endereco.cep ?? '' }}</dd>
            <dt>{{ t('cadastro.ficha.logradouro') }}</dt>
            <dd>
              {{
                [f.endereco.logradouro, f.endereco.numero, f.endereco.complemento]
                  .filter((x) => x !== null && x !== '')
                  .join(', ')
              }}
            </dd>
            <dt>{{ t('cadastro.ficha.bairro') }}</dt>
            <dd>{{ f.endereco.bairro ?? '' }}</dd>
            <dt>{{ t('cadastro.ficha.cidade') }}</dt>
            <dd>{{ [f.endereco.cidade, f.endereco.uf].filter(Boolean).join(' / ') }}</dd>
          </dl>
        </section>
        <section aria-labelledby="sec-contatos">
          <h2 id="sec-contatos">{{ t('cadastro.ficha.contatos') }}</h2>
          <dl>
            <dt>{{ t('cadastro.ficha.telefone') }}</dt>
            <dd>{{ f.contatos.telefone ?? '' }}</dd>
            <dt>{{ t('cadastro.ficha.celular') }}</dt>
            <dd>{{ f.contatos.celular ?? '' }}</dd>
            <dt>{{ t('cadastro.ficha.email') }}</dt>
            <dd>{{ f.contatos.email ?? '' }}</dd>
            <dt>{{ t('cadastro.ficha.responsavel') }}</dt>
            <dd>{{ [f.responsavel.nome, f.responsavel.telefone].filter(Boolean).join(' · ') }}</dd>
          </dl>
        </section>
        <section aria-labelledby="sec-sensiveis" data-testid="secao-sensiveis">
          <h2 id="sec-sensiveis">{{ t('cadastro.ficha.sensiveis') }}</h2>
          <p v-if="!f.sensiveis" data-testid="sensiveis-restritos">
            {{ t('cadastro.ficha.sensiveisRestritos') }}
          </p>
          <dl v-else>
            <dt>{{ t('cadastro.ficha.racaCor') }}</dt>
            <dd data-testid="ficha-raca-cor">{{ f.sensiveis.racaCor?.rotulo ?? '' }}</dd>
            <dt>{{ t('cadastro.ficha.religiao') }}</dt>
            <dd>{{ f.sensiveis.religiao?.rotulo ?? '' }}</dd>
            <dt>{{ t('cadastro.ficha.responsavelLegal') }}</dt>
            <dd>{{ f.sensiveis.responsavelLegal ?? '' }}</dd>
          </dl>
        </section>
        <section aria-labelledby="sec-carteirinhas">
          <h2 id="sec-carteirinhas">{{ t('cadastro.ficha.carteirinhas') }}</h2>
          <p v-if="f.carteirinhas.length === 0">{{ t('cadastro.ficha.semCarteirinha') }}</p>
          <ul v-else>
            <li v-for="c in f.carteirinhas" :key="c.convenio">{{ c.nome }}</li>
          </ul>
        </section>
        <section v-if="f.clinicoLegado.alergia || f.clinicoLegado.medicamentos" aria-labelledby="sec-clinico">
          <h2 id="sec-clinico">{{ t('cadastro.ficha.clinico') }}</h2>
          <p>{{ t('cadastro.ficha.clinicoAjuda') }}</p>
          <dl>
            <template v-if="f.clinicoLegado.alergia">
              <dt>{{ t('cadastro.ficha.alergia') }}</dt>
              <dd>{{ f.clinicoLegado.alergia }}</dd>
            </template>
            <template v-if="f.clinicoLegado.medicamentos">
              <dt>{{ t('cadastro.ficha.medicamentos') }}</dt>
              <dd>{{ f.clinicoLegado.medicamentos }}</dd>
            </template>
          </dl>
        </section>
        <p class="rodape">
          {{
            t('cadastro.ficha.cadastradoEm', {
              data: carimboBr(f.cadastro.em),
              alterado: carimboBr(f.cadastro.alteradoEm),
            })
          }}
        </p>
        <ConsentimentosPaciente
          v-if="pode('cadastro.consentimento.ler')"
          :id-paciente="f.id"
          :pode-registrar="f.permissoes.registrarConsentimento"
        />
        <ContaPortalPaciente v-if="pode('portal.conta.ler')" :id-paciente="f.id" />
      </div>

      <!-- ── edição e cadastro ── -->
      <form
        v-if="editando && (!novo || podeGravar)"
        class="form"
        data-testid="form-paciente"
        novalidate
        @submit.prevent="salvar"
      >
        <SanteAvisoColisao v-if="colisao" :problema="colisao" @rever="rever" @descartar="cancelar" />
        <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="recusa-paciente" />
        <MensagemErro v-if="erro" :erro="erro" />
        <p>{{ t('cadastro.ficha.obrigatorios') }}</p>

        <fieldset>
          <legend>{{ t('cadastro.ficha.documentos') }}</legend>
          <template v-if="cpfEditavel">
            <div class="campo">
              <label for="campo-cpf">{{ t('cadastro.ficha.cpf') }}</label>
              <input
                id="campo-cpf"
                v-model="form.cpf"
                inputmode="numeric"
                maxlength="14"
                data-testid="campo-cpf"
              />
            </div>
            <SanteBotao
              v-if="novo"
              :rotulo="t('cadastro.ficha.procurarCpf')"
              variante="secundario"
              data-testid="botao-procurar-cpf"
              @acionar="procurarCpf"
            />
          </template>
          <p v-else>{{ t('cadastro.ficha.mascarados') }}</p>
          <div v-if="candidatos" role="status" data-testid="candidatos-cpf">
            <template v-if="candidatos.length > 0">
              <p>{{ t('cadastro.ficha.candidatos') }}</p>
              <ul>
                <li v-for="c in candidatos" :key="c.id">
                  <RouterLink :to="`/cadastros/pacientes/${c.id}`" :data-testid="`candidato-${c.id}`">{{
                    t('cadastro.ficha.candidato', {
                      prontuario: c.prontuario,
                      nome: c.nomeMascarado,
                      nascimento: dataBr(c.nascimento),
                    })
                  }}</RouterLink>
                </li>
              </ul>
            </template>
            <p v-else>{{ t('cadastro.ficha.cpfLivre') }}</p>
          </div>
          <SanteCampoTexto
            v-if="cpfEditavel"
            v-model="form.identidade"
            :rotulo="t('cadastro.ficha.identidade')"
            :max-bytes="15"
          />
        </fieldset>

        <fieldset>
          <legend>{{ t('cadastro.ficha.identificacao') }}</legend>
          <SanteCampoTexto
            v-model="form.nome"
            :rotulo="t('cadastro.ficha.nome')"
            :max-bytes="70"
            obrigatorio
            data-testid="campo-nome"
          />
          <SanteData
            v-model="nascimentoModelo"
            :rotulo="t('cadastro.ficha.nascimento')"
            editavel
            data-testid="campo-nascimento"
          />
          <SanteSelecao
            v-model="form.sexo"
            :rotulo="t('cadastro.ficha.sexo')"
            :opcoes="opcoesSexo"
            data-testid="campo-sexo"
          />
          <SanteCampoTexto
            v-model="form.naturalidade"
            :rotulo="t('cadastro.ficha.naturalidade')"
            :max-bytes="30"
            obrigatorio
            data-testid="campo-naturalidade"
          />
          <div class="campo">
            <label for="campo-uf-nat">{{ t('cadastro.ficha.ufNaturalidade') }}</label>
            <input
              id="campo-uf-nat"
              v-model="form.ufNaturalidade"
              maxlength="2"
              data-testid="campo-uf-naturalidade"
            />
          </div>
          <SanteCampoTexto
            v-model="form.nomeMae"
            :rotulo="t('cadastro.ficha.mae')"
            :max-bytes="70"
            data-testid="campo-mae"
          />
        </fieldset>

        <fieldset>
          <legend>{{ t('cadastro.ficha.endereco') }}</legend>
          <p>{{ t('cadastro.ficha.cepAjuda') }}</p>
          <div class="campo">
            <label for="campo-cep">{{ t('cadastro.ficha.cep') }}</label>
            <input
              id="campo-cep"
              v-model="form.cep"
              inputmode="numeric"
              maxlength="9"
              required
              aria-describedby="cep-situacao"
              :aria-invalid="cepErro !== null"
              data-testid="campo-cep"
              @blur="completarCep"
            />
            <span id="cep-situacao" aria-live="polite">
              <span v-if="cepErro" class="erro" data-testid="cep-inexistente">{{ cepErro }}</span>
              <span v-else-if="cidadeUf" data-testid="cep-cidade">{{
                t('cadastro.ficha.cepCidade', { cidade: cidadeUf })
              }}</span>
            </span>
          </div>
          <SanteCampoTexto
            v-model="form.logradouro"
            :rotulo="t('cadastro.ficha.logradouro')"
            :max-bytes="40"
          />
          <div class="campo">
            <label for="campo-numero">{{ t('cadastro.ficha.numero') }}</label>
            <input id="campo-numero" v-model="form.numero" inputmode="numeric" maxlength="6" />
          </div>
          <SanteCampoTexto
            v-model="form.complemento"
            :rotulo="t('cadastro.ficha.complemento')"
            :max-bytes="15"
          />
          <SanteCampoTexto v-model="form.bairro" :rotulo="t('cadastro.ficha.bairro')" :max-bytes="30" />
        </fieldset>

        <fieldset>
          <legend>{{ t('cadastro.ficha.contatos') }}</legend>
          <div class="campo">
            <label for="campo-telefone">{{ t('cadastro.ficha.telefone') }}</label>
            <input
              id="campo-telefone"
              v-model="form.telefone"
              inputmode="tel"
              maxlength="20"
              data-testid="campo-telefone"
            />
          </div>
          <div class="campo">
            <label for="campo-celular">{{ t('cadastro.ficha.celular') }}</label>
            <input
              id="campo-celular"
              v-model="form.celular"
              inputmode="tel"
              maxlength="20"
              data-testid="campo-celular"
            />
          </div>
          <SanteCampoTexto v-model="form.email" :rotulo="t('cadastro.ficha.email')" :max-bytes="50" />
          <SanteCampoTexto
            v-model="form.contatoNome"
            :rotulo="t('cadastro.ficha.contatoNome')"
            :max-bytes="40"
          />
          <div class="campo">
            <label for="campo-contato-tel">{{ t('cadastro.ficha.contatoTelefone') }}</label>
            <input id="campo-contato-tel" v-model="form.contatoTelefone" inputmode="tel" maxlength="20" />
          </div>
        </fieldset>

        <div class="botoes">
          <SanteBotao
            :rotulo="t('cadastro.salvar')"
            variante="primario"
            tipo="submit"
            :desabilitado="salvando || !podeGravar"
            data-testid="botao-salvar-paciente"
          />
          <SanteBotao :rotulo="t('cadastro.cancelar')" variante="texto" @acionar="cancelar" />
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped>
/* Alvo mínimo de toque (WCAG 2.5.8): links de ação e de lista. */
nav a,
.acoes a,
li a,
.link-acao {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}

.cabecalho .acoes,
.botoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.ficha {
  display: grid;
  gap: var(--sgh-espaco-2);
}
dl {
  display: grid;
  grid-template-columns: minmax(10rem, max-content) 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-2);
  margin: 0;
}
dt {
  font-weight: 600;
}
dd {
  margin: 0;
}
.form {
  display: grid;
  gap: var(--sgh-espaco-2);
}
fieldset {
  display: grid;
  gap: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.rodape {
  font-size: var(--sgh-fonte-pequena);
}
.erro {
  color: var(--sgh-alerta);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
