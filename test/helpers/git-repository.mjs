import{mkdtemp,mkdir,writeFile,rm}from'node:fs/promises';
import{tmpdir}from'node:os';
import path from'node:path';
import{execFileSync}from'node:child_process';
export async function createTestGitRepository(context,files){
 const temporaryRoot=path.resolve(tmpdir());
 const checkout=await mkdtemp(path.join(temporaryRoot,'darktide-git-fixture-'));
 const git=(...args)=>execFileSync('git',['-C',checkout,...args],{encoding:'utf8'}).trim();
 const dispose=async()=>{
  const resolved=path.resolve(checkout);
  if(path.dirname(resolved)!==temporaryRoot||!path.basename(resolved).startsWith('darktide-git-fixture-'))throw new Error('unsafe test repository cleanup');
  await rm(resolved,{recursive:true,force:true});
 };
 context.after(dispose);
 git('init','--quiet','--initial-branch=main');
 git('config','user.name','Fixture Author');
 git('config','user.email','fixture@example.test');
 git('config','core.autocrlf','false');
 const remote='https://example.test/public-fixture.git';
 git('remote','add','origin',remote);
 for(const [relative,bytes]of Object.entries(files)){
  const destination=path.resolve(checkout,relative);
  if(!destination.startsWith(checkout+path.sep))throw new Error('unsafe test fixture path');
  await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,bytes);
 }
 git('add','.');
 git('-c','commit.gpgsign=false','commit','--quiet','-m','Create deterministic Git fixture');
 return{checkout,remote,commit:git('rev-parse','HEAD')};
}
