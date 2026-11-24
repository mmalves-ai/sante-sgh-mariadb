<script setup lang="ts">
// Contatos e responsáveis do paciente (F3.1, 02-CAD linhas 3 e 4), numa tela só, por paciente:
//   - endereços, telefones e e-mails: vários por tipo, um principal por espécie (escolhido com um clique), vigência do
//     endereço, aceite de mensagem e de comunicação (LGPD) declarados no ato; "Tirar de uso" nunca apaga;
//   - responsáveis, familiares e contatos: pessoa única pelo CPF (o nome só para CPF novo), papel, parentesco, poderes
//     (sugeridos pelo papel), vigência e as pendências (menor sem representante, comprovante ausente).
// A validação aparece na hora (antes de gravar); o servidor confere tudo de novo pela regra do domínio.
import { tipoDoProblema } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import {
  ajustarContato,
  encerrarResponsavel,
  incluirContato,
  incluirResponsavel,
  lerContatos,
  lerResponsaveis,
  lerTiposFicha,
} from '../api-ficha-complementar.js';

const props = defineProps<{ id: string }>();
const paciente = computed(() => Number(props.id));
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Contatos e responsáveis do paciente',
      voltar: 'Voltar à ficha',
      enderecos: 'Endereços',
      telefones: 'Telefones',
      emails: 'E-mails',
      responsaveis: 'Responsáveis, familiares e contatos',
      tipo: 'Tipo',
      cep: 'CEP',
      logradouro: 'Logradouro (vazio: o do CEP)',
      numero: 'Número',
      semNumero: 'Sem número',
      complemento: 'Complemento',
      bairro: 'Bairro (vazio: o do CEP)',
      inicio: 'Vale desde',
      fim: 'Vale até',
      principal: 'Principal',
      tornarPrincipal: 'Tornar principal',
      tirarDeUso: 'Tirar de uso',
      incluir: 'Incluir',
      fora: 'fora de uso',
      ddd: 'DDD',
      telefone: 'Telefone',
      contato: 'Falar com (telefone de recado)',
      aceitaMensagem: 'O titular aceita mensagem neste número',
      email: 'E-mail',
      finalidade: 'Finalidade',
      aceitaComunicacao: 'Aceita comunicações não obrigatórias',
      aceiteDeclarado: 'Confirmo que o titular declarou o aceite agora',
      aceiteEm: 'aceite em {data}',
      revogarAceite: 'Retirar o aceite',
      reativar: 'Voltar a usar',
      cpf: 'CPF do responsável',
      nome: 'Nome (só para CPF ainda não cadastrado)',
      nascimento: 'Nascimento do responsável',
      papel: 'Papel',
      parentesco: 'Parentesco',
      autorizar: 'Autoriza procedimento',
      informacao: 'Recebe informação clínica',
      documento: 'Retira documento',
      contatoPrincipal: 'Primeiro a ser chamado',
      encerrar: 'Encerrar vínculo',
      motivo: 'Motivo do encerramento',
      levantamento: 'Curatela levantada (decisão judicial)',
      vigente: 'vigente',
      encerrado: 'encerrado até {data}',
      semComprovante: 'sem comprovante',
      vazio: 'Nada cadastrado.',
      gravado: 'Gravado.',
      pend: {
        'menor-sem-representante':
          'Paciente menor de idade sem responsável legal, guardião ou tutor vigente.',
        'comprovante-ausente': 'Guarda, tutela ou curatela sem o comprovante anexado.',
      },
      erro: {
        cep: 'CEP com 8 dígitos.',
        numero: 'Informe o número ou marque "sem número".',
        ddd: 'DDD com 2 dígitos.',
        tel: 'Telefone com 8 a 15 dígitos.',
        email: 'E-mail inválido.',
        aceite: 'O aceite de comunicação precisa da declaração do titular.',
        cpfResp: 'CPF com 11 dígitos.',
        autorizar: 'Só responsável legal, guardião, tutor ou curador autoriza procedimento.',
        motivo: 'Informe o motivo.',
      },
      papeis: {
        responsavel_legal: 'Responsável legal',
        responsavel_financeiro: 'Responsável financeiro',
        familiar: 'Familiar',
        contato_emergencia: 'Contato de emergência',
        acompanhante: 'Acompanhante',
        guardiao_legal: 'Guardião legal',
        curador: 'Curador',
        tutor: 'Tutor',
        dependente: 'Dependente',
      },
      finalidades: {
        pessoal: 'Pessoal',
        profissional: 'Profissional',
        cobranca: 'Cobrança',
        notificacao: 'Notificação',
        nota_fiscal: 'Nota fiscal',
        outro: 'Outro',
      },
    },
  },
});

const PAPEIS = [
  'responsavel_legal',
  'guardiao_legal',
  'tutor',
  'curador',
  'familiar',
  'contato_emergencia',
  'acompanhante',
  'responsavel_financeiro',
  'dependente',
] as const;
const REPRESENTA = ['responsavel_legal', 'guardiao_legal', 'tutor', 'curador'];
const FINALIDADES = ['pessoal', 'profissional', 'cobranca', 'notificacao', 'nota_fiscal', 'outro'] as const;

const podeEditar = computed(() => pode('cadastro.paciente.editar'));
const cliente = useQueryClient();
const contatos = useQuery({
  queryKey: computed(() => ['cadastro', 'contatos', paciente.value]),
  queryFn: () => lerContatos(paciente.value),
});
const responsaveis = useQuery({
  queryKey: computed(() => ['cadastro', 'responsaveis', paciente.value]),
  queryFn: () => lerResponsaveis(paciente.value),
});
const tipos = useQuery({ queryKey: ['cadastro', 'ficha-tipos'], queryFn: () => lerTiposFicha() });

const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const gravando = ref(false);
async function executar(fn: () => Promise<unknown>): Promise<boolean> {
  if (gravando.value) return false;
  gravando.value = true;
  recusa.value = null;
  erro.value = null;
  aviso.value = null;
  try {
    await fn();
    aviso.value = t('gravado');
    await cliente.invalidateQueries({ queryKey: ['cadastro'] });
    return true;
  } catch (e) {
    const tipo = e instanceof ErroApi && e.problema ? tipoDoProblema(e.problema) : null;
    if ((tipo === 'recusa-de-negocio' || tipo === 'entrada-invalida') && e instanceof ErroApi && e.problema)
      recusa.value = e.problema.detail ?? e.problema.title ?? '';
    else erro.value = e;
    return false;
  } finally {
    gravando.value = false;
  }
}
const so = (v: string) => v.replace(/\D+/g, '');

// ── Endereço ──
const end = ref({
  tipo: 0,
  cep: '',
  logradouro: '',
  numero: '',
  semNumero: false,
  complemento: '',
  bairro: '',
  principal: false,
  vigenciaInicio: '',
});
const errosEnd = computed(() => {
  const e: string[] = [];
  if (end.value.cep && so(end.value.cep).length !== 8) e.push(t('erro.cep'));
  if (end.value.cep && !end.value.semNumero && !end.value.numero.trim()) e.push(t('erro.numero'));
  return e;
});
async function incluirEndereco(): Promise<void> {
  if (errosEnd.value.length || !end.value.tipo || !end.value.cep) return;
  const ok = await executar(() =>
    incluirContato(paciente.value, 'enderecos', {
      ...end.value,
      cep: so(end.value.cep),
      vigenciaInicio: end.value.vigenciaInicio || null,
    }),
  );
  if (ok)
    end.value = {
      ...end.value,
      cep: '',
      logradouro: '',
      numero: '',
      complemento: '',
      bairro: '',
      principal: false,
      vigenciaInicio: '',
    };
}

// ── Telefone ──
const tel = ref({ tipo: 0, ddd: '', numero: '', nomeContato: '', aceitaMensagem: false, principal: false });
const errosTel = computed(() => {
  const e: string[] = [];
  if (tel.value.ddd && !/^[1-9]\d$/.test(so(tel.value.ddd))) e.push(t('erro.ddd'));
  if (tel.value.numero && !/^\d{8,15}$/.test(so(tel.value.numero))) e.push(t('erro.tel'));
  return e;
});
async function incluirTelefone(): Promise<void> {
  if (errosTel.value.length || !tel.value.tipo || !tel.value.numero) return;
  const ok = await executar(() =>
    incluirContato(paciente.value, 'telefones', {
      ...tel.value,
      ddd: so(tel.value.ddd),
      numero: so(tel.value.numero),
      ddi: '55',
    }),
  );
  if (ok)
    tel.value = {
      ...tel.value,
      ddd: '',
      numero: '',
      nomeContato: '',
      aceitaMensagem: false,
      principal: false,
    };
}

// ── E-mail ──
const mail = ref({
  email: '',
  finalidade: 'pessoal',
  aceitaComunicacao: false,
  aceiteDeclarado: false,
  principal: false,
});
const errosMail = computed(() => {
  const e: string[] = [];
  if (mail.value.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail.value.email.trim()))
    e.push(t('erro.email'));
  if (mail.value.aceitaComunicacao && !mail.value.aceiteDeclarado) e.push(t('erro.aceite'));
  return e;
});
async function incluirEmail(): Promise<void> {
  if (errosMail.value.length || !mail.value.email) return;
  const ok = await executar(() =>
    incluirContato(paciente.value, 'emails', { ...mail.value, email: mail.value.email.trim() }),
  );
  if (ok)
    mail.value = {
      email: '',
      finalidade: 'pessoal',
      aceitaComunicacao: false,
      aceiteDeclarado: false,
      principal: false,
    };
}

// ── Responsável ──
const resp = ref({
  cpf: '',
  nome: '',
  nascimento: '',
  papel: 'responsavel_legal' as (typeof PAPEIS)[number],
  parentesco: 0,
  autorizarProcedimento: true,
  receberInformacao: true,
  retirarDocumento: true,
  contatoPrincipal: false,
  vigenciaInicio: '',
});
// Poderes sugeridos pelo papel (quem representa recebe os três; os demais, nenhum), ajustáveis.
watch(
  () => resp.value.papel,
  (p) => {
    const r = REPRESENTA.includes(p);
    resp.value = { ...resp.value, autorizarProcedimento: r, receberInformacao: r, retirarDocumento: r };
  },
);
const errosResp = computed(() => {
  const e: string[] = [];
  if (resp.value.cpf && so(resp.value.cpf).length !== 11) e.push(t('erro.cpfResp'));
  if (resp.value.autorizarProcedimento && !REPRESENTA.includes(resp.value.papel)) e.push(t('erro.autorizar'));
  return e;
});
async function incluirResp(): Promise<void> {
  if (errosResp.value.length || !resp.value.cpf) return;
  const ok = await executar(() =>
    incluirResponsavel(paciente.value, {
      ...resp.value,
      cpf: so(resp.value.cpf),
      nome: resp.value.nome || null,
      nascimento: resp.value.nascimento || null,
      parentesco: resp.value.parentesco || null,
      vigenciaInicio: resp.value.vigenciaInicio || null,
    }),
  );
  if (ok) resp.value = { ...resp.value, cpf: '', nome: '', nascimento: '', vigenciaInicio: '' };
}
const encerrando = ref<number | null>(null);
const motivo = ref('');
const levantamento = ref(false);
async function confirmarEncerramento(): Promise<void> {
  if (encerrando.value === null || motivo.value.trim().length < 3) return;
  const ok = await executar(() =>
    encerrarResponsavel(paciente.value, encerrando.value!, {
      motivo: motivo.value.trim(),
      levantamentoCuratela: levantamento.value,
    }),
  );
  if (ok) {
    encerrando.value = null;
    motivo.value = '';
    levantamento.value = false;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="ficha-complementar-titulo" data-testid="tela-ficha-complementar">
    <h1 id="ficha-complementar-titulo">{{ t('titulo') }}</h1>
    <nav class="acoes">
      <RouterLink :to="`/cadastros/pacientes/${paciente}`">{{ t('voltar') }}</RouterLink>
    </nav>
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" data-testid="recusa-ficha" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" data-testid="aviso-ficha" />
    <MensagemErro v-if="erro" :erro="erro" />

    <section aria-labelledby="enderecos-titulo" data-testid="bloco-enderecos">
      <h2 id="enderecos-titulo">{{ t('enderecos') }}</h2>
      <p v-if="contatos.data.value && !contatos.data.value.enderecos.length">{{ t('vazio') }}</p>
      <ul>
        <li v-for="e in contatos.data.value?.enderecos ?? []" :key="e.id" :data-testid="`endereco-${e.id}`">
          <strong v-if="e.principal">{{ t('principal') }} ·</strong>
          {{ e.tipo }} · {{ e.logradouro }} {{ e.numero ?? '' }} {{ e.complemento ?? '' }} ·
          {{ e.bairro ?? '' }} ·
          {{ e.cep }}
          <span v-if="!e.vigente"> · {{ t('fora') }}</span>
          <template v-if="podeEditar && e.vigente">
            <SanteBotao
              v-if="!e.principal"
              :rotulo="t('tornarPrincipal')"
              @acionar="executar(() => ajustarContato(paciente, 'endereco', e.id, 'principal'))"
            />
            <SanteBotao
              :rotulo="t('tirarDeUso')"
              @acionar="executar(() => ajustarContato(paciente, 'endereco', e.id, 'encerrar'))"
            />
          </template>
        </li>
      </ul>
      <form v-if="podeEditar" class="barra" data-testid="form-endereco" @submit.prevent="incluirEndereco">
        <label
          >{{ t('tipo') }}
          <select v-model.number="end.tipo" data-testid="endereco-tipo">
            <option v-for="o in tipos.data.value?.endereco ?? []" :key="o.id" :value="o.id">
              {{ o.descricao }}
            </option>
          </select>
        </label>
        <label
          >{{ t('cep') }}
          <input v-model="end.cep" maxlength="9" inputmode="numeric" data-testid="endereco-cep"
        /></label>
        <label>{{ t('logradouro') }} <input v-model="end.logradouro" maxlength="150" /></label>
        <label
          >{{ t('numero') }}
          <input v-model="end.numero" maxlength="10" :disabled="end.semNumero" data-testid="endereco-numero"
        /></label>
        <label><input v-model="end.semNumero" type="checkbox" /> {{ t('semNumero') }}</label>
        <label>{{ t('complemento') }} <input v-model="end.complemento" maxlength="100" /></label>
        <label>{{ t('bairro') }} <input v-model="end.bairro" maxlength="100" /></label>
        <label>{{ t('inicio') }} <input v-model="end.vigenciaInicio" type="date" /></label>
        <label><input v-model="end.principal" type="checkbox" /> {{ t('principal') }}</label>
        <p v-for="x in errosEnd" :key="x" class="erro-campo" role="alert">{{ x }}</p>
        <SanteBotao
          :rotulo="t('incluir')"
          variante="primario"
          tipo="submit"
          :desabilitado="gravando || errosEnd.length > 0"
        />
      </form>
    </section>

    <section aria-labelledby="telefones-titulo" data-testid="bloco-telefones">
      <h2 id="telefones-titulo">{{ t('telefones') }}</h2>
      <p v-if="contatos.data.value && !contatos.data.value.telefones.length">{{ t('vazio') }}</p>
      <ul>
        <li v-for="x in contatos.data.value?.telefones ?? []" :key="x.id" :data-testid="`telefone-${x.id}`">
          <strong v-if="x.principal">{{ t('principal') }} ·</strong>
          {{ x.tipo }} · ({{ x.ddd ?? '' }}) {{ x.numero }}
          <span v-if="x.nomeContato">· {{ x.nomeContato }}</span>
          <span v-if="!x.ativo"> · {{ t('fora') }}</span>
          <template v-if="podeEditar && x.ativo">
            <SanteBotao
              v-if="!x.principal"
              :rotulo="t('tornarPrincipal')"
              @acionar="executar(() => ajustarContato(paciente, 'telefone', x.id, 'principal'))"
            />
            <SanteBotao
              :rotulo="t('tirarDeUso')"
              @acionar="executar(() => ajustarContato(paciente, 'telefone', x.id, 'encerrar'))"
            />
          </template>
        </li>
      </ul>
      <form v-if="podeEditar" class="barra" data-testid="form-telefone" @submit.prevent="incluirTelefone">
        <label
          >{{ t('tipo') }}
          <select v-model.number="tel.tipo" data-testid="telefone-tipo">
            <option v-for="o in tipos.data.value?.telefone ?? []" :key="o.id" :value="o.id">
              {{ o.descricao }}
            </option>
          </select>
        </label>
        <label>{{ t('ddd') }} <input v-model="tel.ddd" maxlength="2" inputmode="numeric" /></label>
        <label
          >{{ t('telefone') }}
          <input v-model="tel.numero" maxlength="15" inputmode="numeric" data-testid="telefone-numero"
        /></label>
        <label>{{ t('contato') }} <input v-model="tel.nomeContato" maxlength="150" /></label>
        <label><input v-model="tel.aceitaMensagem" type="checkbox" /> {{ t('aceitaMensagem') }}</label>
        <label><input v-model="tel.principal" type="checkbox" /> {{ t('principal') }}</label>
        <p v-for="x in errosTel" :key="x" class="erro-campo" role="alert">{{ x }}</p>
        <SanteBotao
          :rotulo="t('incluir')"
          variante="primario"
          tipo="submit"
          :desabilitado="gravando || errosTel.length > 0"
        />
      </form>
    </section>

    <section aria-labelledby="emails-titulo" data-testid="bloco-emails">
      <h2 id="emails-titulo">{{ t('emails') }}</h2>
      <p v-if="contatos.data.value && !contatos.data.value.emails.length">{{ t('vazio') }}</p>
      <ul>
        <li v-for="x in contatos.data.value?.emails ?? []" :key="x.id" :data-testid="`email-${x.id}`">
          <strong v-if="x.principal">{{ t('principal') }} ·</strong>
          {{ x.email }} · {{ t(`finalidades.${x.finalidade}`) }}
          <span v-if="x.aceitaComunicacao"
            >· {{ t('aceitaComunicacao')
            }}<template v-if="x.aceiteEm">
              ({{ t('aceiteEm', { data: x.aceiteEm.split('-').reverse().join('/') }) }})</template
            ></span
          >
          <span v-if="!x.ativo"> · {{ t('fora') }}</span>
          <SanteBotao
            v-if="podeEditar && !x.ativo"
            :rotulo="t('reativar')"
            :data-testid="`email-reativar-${x.id}`"
            @acionar="executar(() => ajustarContato(paciente, 'email', x.id, 'reativar'))"
          />
          <template v-if="podeEditar && x.ativo">
            <SanteBotao
              v-if="x.aceitaComunicacao"
              :rotulo="t('revogarAceite')"
              :data-testid="`email-revogar-${x.id}`"
              @acionar="executar(() => ajustarContato(paciente, 'email', x.id, 'revogar-aceite'))"
            />
            <SanteBotao
              v-if="!x.principal"
              :rotulo="t('tornarPrincipal')"
              @acionar="executar(() => ajustarContato(paciente, 'email', x.id, 'principal'))"
            />
            <SanteBotao
              :rotulo="t('tirarDeUso')"
              @acionar="executar(() => ajustarContato(paciente, 'email', x.id, 'encerrar'))"
            />
          </template>
        </li>
      </ul>
      <form v-if="podeEditar" class="barra" data-testid="form-email" @submit.prevent="incluirEmail">
        <label
          >{{ t('email') }}
          <input v-model="mail.email" type="email" maxlength="254" data-testid="email-endereco"
        /></label>
        <label
          >{{ t('finalidade') }}
          <select v-model="mail.finalidade">
            <option v-for="f in FINALIDADES" :key="f" :value="f">{{ t(`finalidades.${f}`) }}</option>
          </select>
        </label>
        <label><input v-model="mail.aceitaComunicacao" type="checkbox" /> {{ t('aceitaComunicacao') }}</label>
        <label v-if="mail.aceitaComunicacao"
          ><input v-model="mail.aceiteDeclarado" type="checkbox" data-testid="email-aceite" />
          {{ t('aceiteDeclarado') }}</label
        >
        <label><input v-model="mail.principal" type="checkbox" /> {{ t('principal') }}</label>
        <p v-for="x in errosMail" :key="x" class="erro-campo" role="alert">{{ x }}</p>
        <SanteBotao
          :rotulo="t('incluir')"
          variante="primario"
          tipo="submit"
          :desabilitado="gravando || errosMail.length > 0"
        />
      </form>
    </section>

    <section aria-labelledby="responsaveis-titulo" data-testid="bloco-responsaveis">
      <h2 id="responsaveis-titulo">{{ t('responsaveis') }}</h2>
      <SanteAlerta
        v-for="p in responsaveis.data.value?.pendencias ?? []"
        :key="`${p.pendencia}-${p.vinculo}`"
        :texto="t(`pend.${p.pendencia}`)"
        variante="aviso"
        data-testid="pendencia-responsavel"
      />
      <p v-if="responsaveis.data.value && !responsaveis.data.value.itens.length">{{ t('vazio') }}</p>
      <ul>
        <li
          v-for="r in responsaveis.data.value?.itens ?? []"
          :key="r.id"
          :data-testid="`responsavel-${r.id}`"
        >
          <strong>{{ r.nome }}</strong> · {{ t(`papeis.${r.papel}`) }}
          <span v-if="r.parentesco">· {{ r.parentesco }}</span>
          <span v-if="r.autorizarProcedimento"> · {{ t('autorizar') }}</span>
          <span v-if="r.receberInformacao"> · {{ t('informacao') }}</span>
          <span v-if="r.retirarDocumento"> · {{ t('documento') }}</span>
          · {{ r.vigente ? t('vigente') : t('encerrado', { data: r.vigenciaFim ?? '' }) }}
          <span v-if="!r.temComprovante && ['guardiao_legal', 'tutor', 'curador'].includes(r.papel)">
            · {{ t('semComprovante') }}</span
          >
          <SanteBotao v-if="podeEditar && r.vigente" :rotulo="t('encerrar')" @acionar="encerrando = r.id" />
        </li>
      </ul>
      <form
        v-if="podeEditar && encerrando !== null"
        class="barra"
        data-testid="form-encerrar-responsavel"
        @submit.prevent="confirmarEncerramento"
      >
        <label
          >{{ t('motivo') }} <input v-model="motivo" maxlength="300" data-testid="encerrar-motivo"
        /></label>
        <label><input v-model="levantamento" type="checkbox" /> {{ t('levantamento') }}</label>
        <p v-if="motivo && motivo.trim().length < 3" class="erro-campo" role="alert">
          {{ t('erro.motivo') }}
        </p>
        <SanteBotao :rotulo="t('encerrar')" variante="primario" tipo="submit" :desabilitado="gravando" />
      </form>
      <form v-if="podeEditar" class="barra" data-testid="form-responsavel" @submit.prevent="incluirResp">
        <label
          >{{ t('cpf') }}
          <input v-model="resp.cpf" maxlength="14" inputmode="numeric" data-testid="responsavel-cpf"
        /></label>
        <label
          >{{ t('nome') }} <input v-model="resp.nome" maxlength="150" data-testid="responsavel-nome"
        /></label>
        <label>{{ t('nascimento') }} <input v-model="resp.nascimento" type="date" /></label>
        <label
          >{{ t('papel') }}
          <select v-model="resp.papel" data-testid="responsavel-papel">
            <option v-for="p in PAPEIS" :key="p" :value="p">{{ t(`papeis.${p}`) }}</option>
          </select>
        </label>
        <label
          >{{ t('parentesco') }}
          <select v-model.number="resp.parentesco">
            <option :value="0"></option>
            <option v-for="o in tipos.data.value?.parentesco ?? []" :key="o.id" :value="o.id">
              {{ o.descricao }}
            </option>
          </select>
        </label>
        <label><input v-model="resp.autorizarProcedimento" type="checkbox" /> {{ t('autorizar') }}</label>
        <label><input v-model="resp.receberInformacao" type="checkbox" /> {{ t('informacao') }}</label>
        <label><input v-model="resp.retirarDocumento" type="checkbox" /> {{ t('documento') }}</label>
        <label><input v-model="resp.contatoPrincipal" type="checkbox" /> {{ t('contatoPrincipal') }}</label>
        <label>{{ t('inicio') }} <input v-model="resp.vigenciaInicio" type="date" /></label>
        <p v-for="x in errosResp" :key="x" class="erro-campo" role="alert">{{ x }}</p>
        <SanteBotao
          :rotulo="t('incluir')"
          variante="primario"
          tipo="submit"
          :desabilitado="gravando || errosResp.length > 0"
        />
      </form>
    </section>
  </section>
</template>

<style scoped>
.barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sante-espaco-2, 0.5rem);
  align-items: flex-end;
}
.erro-campo {
  color: var(--sante-cor-perigo, #b00020);
  width: 100%;
}
</style>
