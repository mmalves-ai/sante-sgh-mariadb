<script setup lang="ts">
// Meu certificado (ficha do M49, seção 7; etapa 1): `/conta/certificado`. O próprio usuário vincula o certificado
// ICP-Brasil: em nuvem, autorizando no provedor (OAuth 2.0 com PKCE: o certificado vem do provedor e o CPF dele é
// conferido com o do usuário, regra 2); A1/A3, enviando só a parte pública (a chave fica no computador). A assinatura
// de conferência assina um texto de teste (nenhum documento, nenhum paciente) e mostra a validação feita no servidor
// (assinatura, cadeia, revogação, CPF e carimbo do tempo). A volta do provedor chega aqui com o resultado na URL.
import { type DesafioAgenteLocal, MOTIVOS_RECUSA_ASSINATURA, MOTIVOS_VALIDACAO_ICP } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import ErroAssinatura from '../componentes/ErroAssinatura.vue';
import {
  assinarNoAgente,
  certificadoDoArquivo,
  desvincular,
  lerMeuCertificado,
  responderAgente,
  testarAssinatura,
  vincularArquivo,
  vincularNuvem,
} from '../api-assinatura.js';

const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();
const q = useQuery({ queryKey: ['assinatura', 'certificado'], queryFn: lerMeuCertificado });
const erro = ref<unknown>(null);
const aviso = ref<{ texto: string; variante: 'info' | 'alerta' } | null>(null);
const ocupado = ref(false);
const provedor = ref('');
const midiaArquivo = ref<'a1' | 'a3'>('a3');
const arquivo = ref<string | null>(null);
const arquivoInvalido = ref(false);

const textoMotivo = (m: string | null | undefined) =>
  (m &&
    ((MOTIVOS_RECUSA_ASSINATURA as Record<string, string>)[m] ??
      (MOTIVOS_VALIDACAO_ICP as Record<string, string>)[m])) ||
  t('assinatura.nenhum');

const opcoesProvedor = computed(() => [
  { valor: '', rotulo: t('assinatura.certificado.provedor') },
  ...(q.data.value?.provedores ?? []).map((p) => ({ valor: p.codigo, rotulo: p.nome })),
]);
const opcoesMidia = computed(() => [
  { valor: 'a1' as const, rotulo: t('assinatura.midias.a1') },
  { valor: 'a3' as const, rotulo: t('assinatura.midias.a3') },
]);
const data = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');
const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

onMounted(() => {
  const r = rota.query;
  if (typeof r['resultado'] === 'string') {
    const ok = r['resultado'] === 'ok';
    aviso.value = ok
      ? {
          texto:
            r['finalidade'] === 'vincular'
              ? t('assinatura.certificado.vinculadoOk')
              : t('assinatura.certificado.testeOk'),
          variante: 'info',
        }
      : {
          texto: t('assinatura.certificado.recusado', { motivo: textoMotivo(String(r['motivo'] ?? '')) }),
          variante: 'alerta',
        };
    void roteador.replace({ path: rota.path });
  }
});

async function agir(fn: () => Promise<void>) {
  erro.value = null;
  ocupado.value = true;
  try {
    await fn();
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

const autorizarNuvem = () =>
  agir(async () => {
    const a = await vincularNuvem(provedor.value);
    window.location.assign(a.endereco);
  });

async function escolherArquivo(ev: Event) {
  arquivoInvalido.value = false;
  arquivo.value = null;
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const b64 = certificadoDoArquivo(new Uint8Array(await f.arrayBuffer()));
  if (!b64) arquivoInvalido.value = true;
  else arquivo.value = b64;
}

const enviarArquivo = () =>
  agir(async () => {
    if (!arquivo.value) return;
    await vincularArquivo(midiaArquivo.value, arquivo.value);
    aviso.value = { texto: t('assinatura.certificado.vinculadoOk'), variante: 'info' };
    await q.refetch();
  });

const tirar = (id: number) =>
  agir(async () => {
    await desvincular(id);
    await q.refetch();
  });

const testar = (id: number) =>
  agir(async () => {
    const a = await testarAssinatura(id);
    if (a.tipo === 'nuvem') {
      window.location.assign(a.endereco);
      return;
    }
    const endereco = q.data.value?.agenteLocal;
    if (!endereco) {
      aviso.value = { texto: t('assinatura.assinar.agenteAusente'), variante: 'alerta' };
      return;
    }
    let resp: Awaited<ReturnType<typeof assinarNoAgente>>;
    try {
      resp = await assinarNoAgente(endereco, a as DesafioAgenteLocal);
    } catch {
      aviso.value = { texto: t('assinatura.assinar.agenteAusente'), variante: 'alerta' };
      return;
    }
    const r = await responderAgente({ desafio: a.desafio, ...resp });
    aviso.value = r.ok
      ? { texto: t('assinatura.certificado.testeOk'), variante: 'info' }
      : {
          texto: t('assinatura.certificado.recusado', { motivo: textoMotivo(r.motivo) }),
          variante: 'alerta',
        };
    await q.refetch();
  });
</script>

<template>
  <section class="tela-assinatura" aria-labelledby="cert-titulo" data-testid="tela-meu-certificado">
    <h1 id="cert-titulo">{{ t('assinatura.certificado.titulo') }}</h1>
    <p>{{ t('assinatura.certificado.subtitulo') }}</p>
    <SanteAlerta
      v-if="aviso"
      :texto="aviso.texto"
      :variante="aviso.variante"
      anunciar
      data-testid="cert-aviso"
    />
    <ErroAssinatura v-if="erro || q.error.value" :erro="erro ?? q.error.value" />
    <template v-if="q.data.value">
      <SanteAlerta
        v-if="q.data.value.modo === 'simulador'"
        :texto="t('assinatura.certificado.simulador')"
        variante="aviso"
        data-testid="cert-simulador"
      />
      <SanteAlerta
        v-if="q.data.value.modo === 'desligado'"
        :texto="t('assinatura.certificado.desligado')"
        variante="aviso"
      />
      <p class="secundario">{{ t('assinatura.certificado.nuncaChave') }}</p>
      <p class="secundario" data-testid="cert-concessao">{{ t('assinatura.assinar.concessao') }}</p>

      <table v-if="q.data.value.certificados.length" class="tabela" data-testid="cert-lista">
        <caption class="secundario">
          {{
            t('assinatura.certificado.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('assinatura.certificado.midia') }}</th>
            <th scope="col">{{ t('assinatura.certificado.serie') }}</th>
            <th scope="col">{{ t('assinatura.certificado.tipo') }}</th>
            <th scope="col">{{ t('assinatura.certificado.validade') }}</th>
            <th scope="col">{{ t('assinatura.certificado.cpf') }}</th>
            <th scope="col">{{ t('assinatura.certificado.situacao') }}</th>
            <th scope="col">{{ t('assinatura.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in q.data.value.certificados" :key="c.id" :data-testid="`cert-${c.id}`">
            <td>
              {{ t(`assinatura.midias.${c.midia}`)
              }}<span v-if="c.provedor" class="secundario"> · {{ c.provedor }}</span>
            </td>
            <td>{{ c.serie }}</td>
            <td>{{ c.tipo ?? '—' }}</td>
            <td>{{ t('assinatura.certificado.validoAte', { data: dia(c.validoAte) }) }}</td>
            <td data-testid="cert-cpf">{{ c.cpfMascarado }}</td>
            <td>{{ c.ativo ? t('assinatura.certificado.ativo') : t('assinatura.certificado.inativo') }}</td>
            <td>
              <span v-if="c.ativo" class="acoes">
                <SanteBotao
                  :rotulo="t('assinatura.certificado.testar')"
                  variante="secundario"
                  :desabilitado="ocupado || q.data.value.modo === 'desligado'"
                  data-testid="cert-testar"
                  @acionar="testar(c.id)"
                />
                <SanteBotao
                  :rotulo="t('assinatura.certificado.desvincular')"
                  variante="destrutivo"
                  :confirmacao="t('assinatura.certificado.desvincularConfirma')"
                  :desabilitado="ocupado"
                  data-testid="cert-desvincular"
                  @acionar="tirar(c.id)"
                />
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else data-testid="cert-nenhum">{{ t('assinatura.certificado.nenhum') }}</p>
      <p class="secundario">{{ t('assinatura.certificado.testarAjuda') }}</p>

      <div class="blocos">
        <form class="bloco" data-testid="cert-nuvem" @submit.prevent="autorizarNuvem">
          <h2>{{ t('assinatura.certificado.vincularNuvem') }}</h2>
          <p class="secundario">{{ t('assinatura.certificado.vincularNuvemAjuda') }}</p>
          <template v-if="q.data.value.provedores.length">
            <SanteSelecao
              id="cert-provedor"
              v-model="provedor"
              :rotulo="t('assinatura.certificado.provedor')"
              :opcoes="opcoesProvedor"
              data-testid="cert-provedor"
            />
            <SanteBotao
              :rotulo="t('assinatura.certificado.autorizar')"
              tipo="submit"
              :desabilitado="ocupado || !provedor"
              data-testid="cert-autorizar"
            />
          </template>
          <p v-else role="note">{{ t('assinatura.certificado.semProvedor') }}</p>
        </form>
        <form class="bloco" data-testid="cert-arquivo" @submit.prevent="enviarArquivo">
          <h2>{{ t('assinatura.certificado.vincularArquivo') }}</h2>
          <p class="secundario">{{ t('assinatura.certificado.vincularArquivoAjuda') }}</p>
          <SanteSelecao
            id="cert-midia"
            v-model="midiaArquivo"
            :rotulo="t('assinatura.certificado.midia')"
            :opcoes="opcoesMidia"
          />
          <span class="campo">
            <label for="cert-arquivo-campo">{{ t('assinatura.certificado.arquivo') }}</label>
            <input
              id="cert-arquivo-campo"
              type="file"
              accept=".cer,.crt,.der,.pem"
              data-testid="cert-arquivo-campo"
              @change="escolherArquivo"
            />
          </span>
          <SanteAlerta v-if="arquivoInvalido" :texto="t('assinatura.certificado.arquivoInvalido')" anunciar />
          <SanteBotao
            :rotulo="t('assinatura.certificado.enviarArquivo')"
            tipo="submit"
            :desabilitado="ocupado || !arquivo || q.data.value.modo === 'desligado'"
            data-testid="cert-enviar-arquivo"
          />
        </form>
      </div>

      <h2>{{ t('assinatura.certificado.conferencias') }}</h2>
      <table v-if="q.data.value.testes.length" class="tabela" data-testid="cert-conferencias">
        <thead>
          <tr>
            <th scope="col">{{ t('assinatura.certificado.em') }}</th>
            <th scope="col">{{ t('assinatura.politica.politicaIcp') }}</th>
            <th scope="col">{{ t('assinatura.certificado.situacao') }}</th>
            <th scope="col">{{ t('assinatura.certificado.resultado') }}</th>
            <th scope="col">{{ t('assinatura.certificado.carimbo') }}</th>
            <th scope="col">{{ t('assinatura.certificado.detalhes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in q.data.value.testes" :key="x.id" data-testid="cert-conferencia">
            <td>{{ data(x.criadoEm) }}</td>
            <td>{{ t(`assinatura.politicas.${x.politicaIcp}`) }}</td>
            <td data-testid="conf-estado">
              {{ t(`assinatura.estados.${x.estado}`)
              }}<span v-if="x.falha" class="secundario"> · {{ t(`assinatura.falhas.${x.falha}`) }}</span>
            </td>
            <td data-testid="conf-resultado">
              {{ x.validacao ? t(`assinatura.resultados.${x.validacao.resultado}`) : '—' }}
            </td>
            <td>{{ data(x.carimboEm) }}</td>
            <td>
              <span v-if="x.validacao?.motivos.length">{{
                x.validacao.motivos.map(textoMotivo).join(' ')
              }}</span>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('assinatura.certificado.nenhumaConferencia') }}</p>
    </template>
  </section>
</template>

<style src="../estilo-assinatura.css"></style>
