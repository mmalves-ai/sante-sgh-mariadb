<script setup lang="ts">
// 01-ADM linha 77: e-mail do sistema numa tela só. Servidores de saída (a senha nunca aparece nem é digitada aqui:
// só a referência dela no cofre; o teste de conexão mostra e guarda o resultado), modelos de mensagem (os campos
// nascem dos marcadores do texto e a pré-visualização troca cada um pelo exemplo, na hora) e o registro dos últimos
// envios. A regra do domínio valida na hora, antes de ir ao servidor; a recusa do servidor aparece no painel.
import {
  marcadoresDoModelo,
  MENSAGEM_EMAIL,
  portaSugerida,
  preencherModelo,
  SEGURANCAS_EMAIL,
  type SegurancaEmail,
  validarModeloEmail,
  validarServidorEmail,
} from '@sgh/dominio-acesso/autorizacao';
import { SanteBotao, SanteCampoTexto, SanteChave, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { novaChave } from '../../agenda/api-agenda.js';
import {
  gravarModeloEmail,
  gravarServidorEmail,
  lerPainelEmail,
  type ModeloEmailEnvio,
  type ServidorEmailEnvio,
  testarServidorEmail,
} from '../api-email.js';

const props = defineProps<{ podeEditar: boolean }>();
const { t } = useI18n();
const qc = useQueryClient();
const CHAVE = ['adm', 'email-sistema'];
const dados = useQuery({ queryKey: CHAVE, queryFn: lerPainelEmail });
const erro = ref<unknown>(null);
const mensagem = ref('');
const nulo = (v: string): string | null => (v.trim() === '' ? null : v.trim());
// Instante do servidor na hora local de quem lê.
const quando = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : t('emailSistema.nenhum');

async function executar<T>(fn: () => Promise<T>, aviso: (r: T) => string): Promise<T | null> {
  erro.value = null;
  mensagem.value = '';
  try {
    const r = await fn();
    mensagem.value = aviso(r);
    await qc.invalidateQueries({ queryKey: CHAVE });
    return r;
  } catch (e) {
    erro.value = e;
    return null;
  }
}

const opcoesFinalidade = computed(() =>
  (dados.data.value?.finalidades ?? []).map((f) => ({ valor: f.codigo, rotulo: f.descricao })),
);

// ── Servidores ──
const servidorEscolhido = ref('');
const servidor = computed(
  () => dados.data.value?.servidores.find((s) => String(s.id) === servidorEscolhido.value) ?? null,
);
const opcoesServidor = computed(() => [
  { valor: '', rotulo: t('emailSistema.novo') },
  ...(dados.data.value?.servidores ?? []).map((s) => ({
    valor: String(s.id),
    rotulo: `${s.codigo} · ${s.nome}`,
  })),
]);
const opcoesSeguranca = SEGURANCAS_EMAIL.map((s) => ({
  valor: s as string,
  rotulo: t(`emailSistema.servidores.segurancas.${s}`),
}));
const opcoesFinalidadeServidor = computed(() => [
  { valor: '', rotulo: t('emailSistema.todas') },
  ...opcoesFinalidade.value,
]);
const servidorVazio = () => ({
  todos: false,
  finalidade: '',
  codigo: '',
  nome: '',
  host: '',
  porta: '587',
  seguranca: 'starttls',
  autentica: true,
  usuario: '',
  referencia: '',
  remetenteEmail: '',
  remetenteNome: '',
  responderPara: '',
  tempo: '30',
  limite: '',
  padrao: false,
  ativo: true,
});
const rs = ref(servidorVazio());
const lidoServidor = ref('');
watch(
  servidor,
  (s) => {
    rs.value = s
      ? {
          todos: s.todosEstabelecimentos,
          finalidade: s.finalidade ?? '',
          codigo: s.codigo,
          nome: s.nome,
          host: s.host,
          porta: String(s.porta),
          seguranca: s.seguranca,
          autentica: s.exigeAutenticacao,
          usuario: s.usuarioAutenticacao ?? '',
          referencia: s.referenciaCofre ?? '',
          remetenteEmail: s.remetenteEmail,
          remetenteNome: s.remetenteNome ?? '',
          responderPara: s.responderPara ?? '',
          tempo: String(s.tempoLimiteSegundos),
          limite: s.limiteEnvioHora === null ? '' : String(s.limiteEnvioHora),
          padrao: s.padrao,
          ativo: s.ativo,
        }
      : servidorVazio();
    lidoServidor.value = JSON.stringify(rs.value);
  },
  { immediate: true },
);
// A troca da segurança leva a porta habitual junto, enquanto a porta ainda for a habitual da anterior.
watch(
  () => rs.value.seguranca,
  (nova, antiga) => {
    if (antiga && rs.value.porta === String(portaSugerida(antiga as SegurancaEmail)))
      rs.value.porta = String(portaSugerida(nova as SegurancaEmail));
  },
);
const envioServidor = computed<ServidorEmailEnvio>(() => ({
  ...(servidor.value ? { id: servidor.value.id, versao: servidor.value.versao } : {}),
  todosEstabelecimentos: rs.value.todos,
  finalidade: nulo(rs.value.finalidade),
  codigo: rs.value.codigo.trim(),
  nome: rs.value.nome.trim(),
  host: rs.value.host.trim(),
  porta: Number(rs.value.porta),
  seguranca: rs.value.seguranca,
  exigeAutenticacao: rs.value.autentica,
  usuarioAutenticacao: rs.value.autentica ? nulo(rs.value.usuario) : null,
  referenciaCofre: rs.value.autentica ? nulo(rs.value.referencia) : null,
  remetenteEmail: rs.value.remetenteEmail.trim(),
  remetenteNome: nulo(rs.value.remetenteNome),
  responderPara: nulo(rs.value.responderPara),
  copiaRemetente: servidor.value?.copiaRemetente ?? false,
  tempoLimiteSegundos: Number(rs.value.tempo),
  limiteEnvioHora: rs.value.limite.trim() === '' ? null : Number(rs.value.limite),
  padrao: rs.value.padrao,
  ativo: rs.value.ativo,
}));
// Validação na hora, pela mesma regra do domínio que o servidor aplica.
const recusaServidor = computed(() => {
  const r = validarServidorEmail(envioServidor.value);
  return r ? MENSAGEM_EMAIL[r] : '';
});
const servidorMudou = computed(() => JSON.stringify(rs.value) !== lidoServidor.value);
const situacaoTeste = computed(() => {
  const s = servidor.value;
  if (!s || s.ultimoTesteSucesso === null) return t('emailSistema.servidores.nuncaTestado');
  return t(s.ultimoTesteSucesso ? 'emailSistema.servidores.testeOk' : 'emailSistema.servidores.testeFalhou', {
    quando: quando(s.ultimoTesteEm),
  });
});
async function salvarServidor() {
  const r = await executar(
    () => gravarServidorEmail(envioServidor.value, novaChave('email-servidor')),
    () => t('emailSistema.gravado'),
  );
  if (r) servidorEscolhido.value = String(r.resultado.servidor);
}
async function testar() {
  if (!servidor.value) return;
  await executar(
    () => testarServidorEmail(servidor.value!.id, novaChave('email-teste')),
    (r) =>
      r.resultado.sucesso
        ? t('emailSistema.servidores.resultadoOk')
        : t('emailSistema.servidores.resultadoFalhou', { detalhe: r.resultado.detalhe }),
  );
}

// ── Modelos ──
const modeloEscolhido = ref('');
const modelo = computed(
  () => dados.data.value?.modelos.find((m) => String(m.id) === modeloEscolhido.value) ?? null,
);
const opcoesModelo = computed(() => [
  { valor: '', rotulo: t('emailSistema.novo') },
  ...(dados.data.value?.modelos ?? []).map((m) => ({
    valor: String(m.id),
    rotulo: `${m.codigo} · ${m.nome}`,
  })),
]);
// Fora do template: as chaves do marcador fechariam a interpolação.
const EXEMPLO_MARCADOR = '{{pessoa.nome}}';
const modeloVazio = () => ({
  todos: false,
  finalidade: '',
  codigo: '',
  nome: '',
  assunto: '',
  corpoHtml: '',
  corpoTexto: '',
  inicio: '',
  fim: '',
  ativo: true,
});
const rm = ref(modeloVazio());
const campos = ref<Record<string, { descricao: string; exemplo: string }>>({});
watch(
  modelo,
  (m) => {
    rm.value = m
      ? {
          todos: m.todosEstabelecimentos,
          finalidade: m.finalidade,
          codigo: m.codigo,
          nome: m.nome,
          assunto: m.assunto,
          corpoHtml: m.corpoHtml,
          corpoTexto: m.corpoTexto ?? '',
          inicio: m.vigenciaInicio ?? '',
          fim: m.vigenciaFim ?? '',
          ativo: m.ativo,
        }
      : modeloVazio();
    campos.value = Object.fromEntries(
      (m?.campos ?? []).map((c) => [c.marcador, { descricao: c.descricao, exemplo: c.exemplo ?? '' }]),
    );
  },
  { immediate: true },
);
const textoModelo = computed(() => ({
  assunto: rm.value.assunto,
  corpoHtml: rm.value.corpoHtml,
  corpoTexto: nulo(rm.value.corpoTexto),
  textoSms: modelo.value?.textoSms ?? null,
}));
const marcadores = computed(() => marcadoresDoModelo(textoModelo.value));
// Cada marcador do texto ganha a sua linha de descrição e exemplo assim que é digitado.
watch(
  marcadores,
  (lista) => {
    for (const m of lista) campos.value[m] ??= { descricao: m, exemplo: '' };
  },
  { immediate: true },
);
const envioModelo = computed<ModeloEmailEnvio>(() => ({
  ...(modelo.value ? { id: modelo.value.id, versao: modelo.value.versao } : {}),
  todosEstabelecimentos: rm.value.todos,
  finalidade: rm.value.finalidade,
  codigo: rm.value.codigo.trim(),
  nome: rm.value.nome.trim(),
  assunto: rm.value.assunto,
  corpoHtml: rm.value.corpoHtml,
  corpoTexto: nulo(rm.value.corpoTexto),
  remetenteNome: modelo.value?.remetenteNome ?? null,
  remetenteEmail: modelo.value?.remetenteEmail ?? null,
  responderPara: modelo.value?.responderPara ?? null,
  enviaSms: modelo.value?.enviaSms ?? false,
  textoSms: modelo.value?.textoSms ?? null,
  vigenciaInicio: nulo(rm.value.inicio),
  vigenciaFim: nulo(rm.value.fim),
  ativo: rm.value.ativo,
  campos: marcadores.value.map((m) => ({
    marcador: m,
    descricao: campos.value[m]?.descricao.trim() || m,
    exemplo: nulo(campos.value[m]?.exemplo ?? ''),
  })),
}));
const recusaModelo = computed(() => {
  const r = validarModeloEmail(envioModelo.value);
  return r ? MENSAGEM_EMAIL[r] : '';
});
const previa = computed(() => {
  const exemplos = Object.fromEntries(
    marcadores.value.filter((m) => campos.value[m]?.exemplo.trim()).map((m) => [m, campos.value[m]!.exemplo]),
  );
  const assunto = preencherModelo(rm.value.assunto, exemplos);
  const corpo = preencherModelo(rm.value.corpoHtml, exemplos, true);
  return {
    assunto: assunto.texto,
    corpo: corpo.texto,
    faltando: [...new Set([...assunto.faltando, ...corpo.faltando])],
  };
});
async function salvarModelo() {
  const r = await executar(
    () => gravarModeloEmail(envioModelo.value, novaChave('email-modelo')),
    () => t('emailSistema.gravado'),
  );
  if (r) modeloEscolhido.value = String(r.resultado.modelo);
}

// ── Registro de envio ──
const filtroSituacao = ref('');
const SITUACOES = ['pendente', 'enviando', 'enviado', 'falhou', 'cancelado', 'capturado'];
const opcoesSituacao = computed(() => [
  { valor: '', rotulo: t('emailSistema.envios.todas') },
  ...SITUACOES.map((s) => ({ valor: s, rotulo: t(`emailSistema.envios.situacoes.${s}`) })),
]);
const envios = computed(() =>
  (dados.data.value?.envios ?? []).filter(
    (e) => !filtroSituacao.value || e.situacao === filtroSituacao.value,
  ),
);
const rotuloSituacao = (s: string) => (SITUACOES.includes(s) ? t(`emailSistema.envios.situacoes.${s}`) : s);
</script>

<template>
  <div data-testid="email-sistema">
    <p v-if="dados.isPending.value">{{ t('emailSistema.carregando') }}</p>
    <template v-else-if="dados.data.value">
      <section class="painel" aria-labelledby="email-servidores-titulo">
        <h2 id="email-servidores-titulo">{{ t('emailSistema.servidores.titulo') }}</h2>
        <SanteSelecao
          v-model="servidorEscolhido"
          :rotulo="t('emailSistema.servidores.escolhido')"
          :opcoes="opcoesServidor"
          data-testid="email-servidor-escolhido"
        />
        <form data-testid="email-servidor" @submit.prevent="salvarServidor">
          <fieldset :disabled="!props.podeEditar">
            <legend>{{ t('emailSistema.servidores.legenda') }}</legend>
            <div class="grade">
              <SanteCampoTexto
                v-model="rs.codigo"
                :rotulo="t('emailSistema.servidores.codigo')"
                :max-bytes="30"
              />
              <SanteCampoTexto
                v-model="rs.nome"
                :rotulo="t('emailSistema.servidores.nome')"
                :max-bytes="150"
              />
              <SanteCampoTexto
                v-model="rs.host"
                :rotulo="t('emailSistema.servidores.host')"
                :max-bytes="255"
              />
              <SanteSelecao
                v-model="rs.seguranca"
                :rotulo="t('emailSistema.servidores.seguranca')"
                :opcoes="opcoesSeguranca"
                data-testid="email-servidor-seguranca"
              />
              <SanteCampoTexto
                v-model="rs.porta"
                :rotulo="t('emailSistema.servidores.porta')"
                :max-bytes="5"
              />
              <SanteSelecao
                v-model="rs.finalidade"
                :rotulo="t('emailSistema.servidores.finalidade')"
                :opcoes="opcoesFinalidadeServidor"
              />
              <SanteCampoTexto
                v-model="rs.remetenteEmail"
                :rotulo="t('emailSistema.servidores.remetenteEmail')"
                :max-bytes="254"
              />
              <SanteCampoTexto
                v-model="rs.remetenteNome"
                :rotulo="t('emailSistema.servidores.remetenteNome')"
                :max-bytes="150"
              />
              <SanteCampoTexto
                v-model="rs.responderPara"
                :rotulo="t('emailSistema.servidores.responderPara')"
                :max-bytes="254"
              />
              <SanteCampoTexto
                v-model="rs.tempo"
                :rotulo="t('emailSistema.servidores.tempoLimite')"
                :max-bytes="3"
              />
              <SanteCampoTexto
                v-model="rs.limite"
                :rotulo="t('emailSistema.servidores.limiteHora')"
                :max-bytes="9"
              />
            </div>
            <SanteChave
              :ligada="rs.autentica"
              :rotulo="t('emailSistema.servidores.exigeAutenticacao')"
              :desabilitada="!props.podeEditar"
              data-testid="email-servidor-autentica"
              @alternar="(v: boolean) => (rs.autentica = v)"
            />
            <div v-if="rs.autentica" class="grade">
              <SanteCampoTexto
                v-model="rs.usuario"
                :rotulo="t('emailSistema.servidores.usuario')"
                :max-bytes="254"
              />
              <SanteCampoTexto
                v-model="rs.referencia"
                :rotulo="t('emailSistema.servidores.referenciaCofre')"
                :max-bytes="200"
              />
            </div>
            <p v-if="rs.autentica" class="ajuda">{{ t('emailSistema.servidores.referenciaAjuda') }}</p>
            <SanteChave
              :ligada="rs.padrao"
              :rotulo="t('emailSistema.servidores.padrao')"
              :desabilitada="!props.podeEditar"
              data-testid="email-servidor-padrao"
              @alternar="(v: boolean) => (rs.padrao = v)"
            />
            <SanteChave
              :ligada="rs.ativo"
              :rotulo="t('emailSistema.ativo')"
              :desabilitada="!props.podeEditar"
              data-testid="email-servidor-ativo"
              @alternar="(v: boolean) => (rs.ativo = v)"
            />
            <SanteChave
              :ligada="rs.todos"
              :rotulo="t('emailSistema.alcance')"
              :desabilitada="!props.podeEditar || !!servidor"
              :motivo="servidor ? t('emailSistema.alcanceFixo') : ''"
              data-testid="email-servidor-todos"
              @alternar="(v: boolean) => (rs.todos = v)"
            />
            <p v-if="recusaServidor" role="alert" data-testid="email-servidor-recusa">{{ recusaServidor }}</p>
            <div v-if="props.podeEditar" class="acoes">
              <SanteBotao
                tipo="submit"
                :rotulo="t('emailSistema.gravar')"
                :desabilitado="!!recusaServidor"
                data-testid="email-servidor-gravar"
              />
              <SanteBotao
                v-if="servidor"
                variante="secundario"
                :rotulo="t('emailSistema.servidores.testar')"
                :desabilitado="servidorMudou"
                data-testid="email-servidor-testar"
                @acionar="testar"
              />
              <span v-if="servidor && servidorMudou" class="ajuda">
                {{ t('emailSistema.servidores.testarAntes') }}
              </span>
            </div>
          </fieldset>
        </form>
        <p v-if="servidor" data-testid="email-servidor-teste">{{ situacaoTeste }}</p>
      </section>

      <section class="painel" aria-labelledby="email-modelos-titulo">
        <h2 id="email-modelos-titulo">{{ t('emailSistema.modelos.titulo') }}</h2>
        <p v-if="opcoesFinalidade.length === 0" data-testid="email-sem-finalidade">
          {{ t('emailSistema.modelos.semFinalidade') }}
        </p>
        <template v-else>
          <SanteSelecao
            v-model="modeloEscolhido"
            :rotulo="t('emailSistema.modelos.escolhido')"
            :opcoes="opcoesModelo"
            data-testid="email-modelo-escolhido"
          />
          <form data-testid="email-modelo" @submit.prevent="salvarModelo">
            <fieldset :disabled="!props.podeEditar">
              <legend>{{ t('emailSistema.modelos.legenda') }}</legend>
              <div class="grade">
                <SanteCampoTexto
                  v-model="rm.codigo"
                  :rotulo="t('emailSistema.modelos.codigo')"
                  :max-bytes="30"
                />
                <SanteCampoTexto
                  v-model="rm.nome"
                  :rotulo="t('emailSistema.modelos.nome')"
                  :max-bytes="100"
                />
                <SanteSelecao
                  v-model="rm.finalidade"
                  :rotulo="t('emailSistema.modelos.finalidade')"
                  :opcoes="opcoesFinalidade"
                  obrigatorio
                  data-testid="email-modelo-finalidade"
                />
                <SanteCampoTexto
                  v-model="rm.inicio"
                  :rotulo="t('emailSistema.modelos.vigenciaInicio')"
                  :max-bytes="10"
                />
                <SanteCampoTexto
                  v-model="rm.fim"
                  :rotulo="t('emailSistema.modelos.vigenciaFim')"
                  :max-bytes="10"
                />
              </div>
              <p class="ajuda">
                {{ t('emailSistema.modelos.marcadoresAjuda', { exemplo: EXEMPLO_MARCADOR }) }}
              </p>
              <SanteCampoTexto
                v-model="rm.assunto"
                :rotulo="t('emailSistema.modelos.assunto')"
                :max-bytes="250"
              />
              <SanteCampoTexto
                v-model="rm.corpoHtml"
                :rotulo="t('emailSistema.modelos.corpoHtml')"
                :max-bytes="200000"
                multilinha
              />
              <SanteCampoTexto
                v-model="rm.corpoTexto"
                :rotulo="t('emailSistema.modelos.corpoTexto')"
                :max-bytes="60000"
                multilinha
              />
              <fieldset v-if="marcadores.length" data-testid="email-modelo-campos">
                <legend>{{ t('emailSistema.modelos.campos') }}</legend>
                <div v-for="m in marcadores" :key="m" class="grade">
                  <SanteCampoTexto
                    v-model="campos[m]!.descricao"
                    :rotulo="t('emailSistema.modelos.campoDescricao', { marcador: m })"
                    :max-bytes="200"
                  />
                  <SanteCampoTexto
                    v-model="campos[m]!.exemplo"
                    :rotulo="t('emailSistema.modelos.campoExemplo', { marcador: m })"
                    :max-bytes="200"
                  />
                </div>
              </fieldset>
              <SanteChave
                :ligada="rm.ativo"
                :rotulo="t('emailSistema.ativo')"
                :desabilitada="!props.podeEditar"
                data-testid="email-modelo-ativo"
                @alternar="(v: boolean) => (rm.ativo = v)"
              />
              <SanteChave
                :ligada="rm.todos"
                :rotulo="t('emailSistema.alcance')"
                :desabilitada="!props.podeEditar || !!modelo"
                :motivo="modelo ? t('emailSistema.alcanceFixo') : ''"
                data-testid="email-modelo-todos"
                @alternar="(v: boolean) => (rm.todos = v)"
              />
              <p v-if="recusaModelo" role="alert" data-testid="email-modelo-recusa">{{ recusaModelo }}</p>
              <SanteBotao
                v-if="props.podeEditar"
                tipo="submit"
                :rotulo="t('emailSistema.gravar')"
                :desabilitado="!!recusaModelo || !rm.finalidade"
                data-testid="email-modelo-gravar"
              />
            </fieldset>
          </form>
          <section
            v-if="rm.assunto || rm.corpoHtml"
            aria-labelledby="email-previa-titulo"
            data-testid="email-previa"
          >
            <h3 id="email-previa-titulo">{{ t('emailSistema.modelos.previa') }}</h3>
            <p>
              <strong>{{ t('emailSistema.modelos.previaAssunto') }}</strong> {{ previa.assunto }}
            </p>
            <pre class="previa">{{ previa.corpo }}</pre>
            <p v-if="previa.faltando.length" data-testid="email-previa-faltando">
              {{ t('emailSistema.modelos.faltando', { lista: previa.faltando.join(', ') }) }}
            </p>
          </section>
        </template>
      </section>

      <section class="painel" aria-labelledby="email-envios-titulo">
        <h2 id="email-envios-titulo">{{ t('emailSistema.envios.titulo') }}</h2>
        <p>{{ t('emailSistema.envios.texto') }}</p>
        <SanteSelecao
          v-model="filtroSituacao"
          :rotulo="t('emailSistema.envios.filtro')"
          :opcoes="opcoesSituacao"
          data-testid="email-envios-filtro"
        />
        <p v-if="envios.length === 0" data-testid="email-envios-vazio">
          {{ t('emailSistema.envios.vazio') }}
        </p>
        <div v-else class="rolagem">
          <table data-testid="email-envios">
            <caption class="oculto">
              {{
                t('emailSistema.envios.titulo')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('emailSistema.envios.quando') }}</th>
                <th scope="col">{{ t('emailSistema.envios.assunto') }}</th>
                <th scope="col">{{ t('emailSistema.envios.destinatarios') }}</th>
                <th scope="col">{{ t('emailSistema.envios.situacao') }}</th>
                <th scope="col">{{ t('emailSistema.envios.tentativas') }}</th>
                <th scope="col">{{ t('emailSistema.envios.identificador') }}</th>
                <th scope="col">{{ t('emailSistema.envios.erro') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in envios" :key="e.id">
                <td>{{ quando(e.ocorridoEm) }}</td>
                <th scope="row">{{ e.assunto }}</th>
                <td>{{ e.destinatarios.map((x) => x.email).join(', ') }}</td>
                <td>{{ rotuloSituacao(e.situacao) }}</td>
                <td>{{ e.tentativas }}</td>
                <td>{{ e.identificadorMensagem ?? t('emailSistema.nenhum') }}</td>
                <td>{{ e.erro ?? t('emailSistema.nenhum') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
    <p v-if="mensagem" role="status" data-testid="email-sistema-mensagem">{{ mensagem }}</p>
    <MensagemErro v-if="erro || dados.error.value" :erro="erro ?? dados.error.value" />
  </div>
</template>

<style scoped>
.painel {
  margin-top: var(--sgh-espaco-4);
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: var(--sgh-espaco-2);
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2);
  margin-top: var(--sgh-espaco-2);
}
.rolagem {
  overflow-x: auto;
}
.previa {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
}
table {
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
